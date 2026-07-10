from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional
from uuid import uuid4

from fastapi import APIRouter, Body, Depends, HTTPException, Response, status
from pydantic import BaseModel

from app.core.supabase import sb_delete, sb_insert, sb_select, sb_update, sb_upsert
from app.shared.auth.deps import get_current_user

ADMIN_EMAIL = "tech.support@enterprateai.com"

router = APIRouter(prefix="/admin", tags=["admin"])


def require_admin(user=Depends(get_current_user)):
    if user.get("email") != ADMIN_EMAIL:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access only.")
    return user


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _select_restrictions(user_id: str, columns: str = "id,module_key,feature_key,created_at") -> list:
    """Gracefully returns [] if the table doesn't exist yet (pre-migration)."""
    try:
        return await sb_select(
            "user_platform_restrictions",
            filters=[("user_id", "eq", user_id)],
            columns=columns,
            order="created_at",
        )
    except Exception:
        return []


async def _select_users_with_block(columns: str = "id,email,created_at,is_blocked,block_reason", **kwargs) -> list:
    """Falls back to base columns if is_blocked column doesn't exist yet (pre-migration)."""
    try:
        return await sb_select("users", columns=columns, **kwargs)
    except Exception:
        rows = await sb_select("users", columns="id,email,created_at", **kwargs)
        for r in rows:
            r.setdefault("is_blocked", False)
            r.setdefault("block_reason", None)
        return rows


# ── Read endpoints ────────────────────────────────────────────────────────────

async def _select_ai_usage_events() -> list:
    try:
        return await sb_select(
            "ai_usage_events",
            columns="id,user_id,feature,provider,model,input_tokens,output_tokens,total_tokens,estimated_cost_usd,created_at",
            order="created_at",
            desc=True,
            limit=1000,
        )
    except Exception:
        return []


def _rollup_ai_usage(rows: list, user_email_map: dict[str, str]) -> dict:
    def amount(value) -> float:
        try:
            return float(value or 0)
        except Exception:
            return 0.0

    total_cost = sum(amount(r.get("estimated_cost_usd")) for r in rows)
    total_tokens = sum(int(r.get("total_tokens") or 0) for r in rows)
    input_tokens = sum(int(r.get("input_tokens") or 0) for r in rows)
    output_tokens = sum(int(r.get("output_tokens") or 0) for r in rows)

    def grouped(key: str, label_key: str | None = None, limit: int = 8) -> list[dict]:
        acc: dict[str, dict] = {}
        for row in rows:
            label = str(row.get(key) or "unknown")
            if label_key:
                label = f"{row.get(key) or 'unknown'} / {row.get(label_key) or 'unknown'}"
            item = acc.setdefault(label, {"label": label, "calls": 0, "tokens": 0, "estimated_cost_usd": 0.0})
            item["calls"] += 1
            item["tokens"] += int(row.get("total_tokens") or 0)
            item["estimated_cost_usd"] += amount(row.get("estimated_cost_usd"))
        out = sorted(acc.values(), key=lambda x: (x["estimated_cost_usd"], x["tokens"], x["calls"]), reverse=True)
        for item in out:
            item["estimated_cost_usd"] = round(item["estimated_cost_usd"], 6)
        return out[:limit]

    user_acc: dict[str, dict] = {}
    for row in rows:
        user_id = str(row.get("user_id") or "")
        label = user_email_map.get(user_id, user_id or "unknown")
        item = user_acc.setdefault(label, {"user_id": user_id, "email": label, "calls": 0, "tokens": 0, "estimated_cost_usd": 0.0})
        item["calls"] += 1
        item["tokens"] += int(row.get("total_tokens") or 0)
        item["estimated_cost_usd"] += amount(row.get("estimated_cost_usd"))
    top_users = sorted(user_acc.values(), key=lambda x: (x["estimated_cost_usd"], x["tokens"], x["calls"]), reverse=True)[:8]
    for item in top_users:
        item["estimated_cost_usd"] = round(item["estimated_cost_usd"], 6)

    recent = []
    for row in rows[:25]:
        user_id = str(row.get("user_id") or "")
        recent.append({
            "id": row.get("id"),
            "user_id": user_id,
            "user_email": user_email_map.get(user_id, user_id or "unknown"),
            "feature": row.get("feature") or "unknown",
            "provider": row.get("provider") or "unknown",
            "model": row.get("model") or "unknown",
            "input_tokens": int(row.get("input_tokens") or 0),
            "output_tokens": int(row.get("output_tokens") or 0),
            "total_tokens": int(row.get("total_tokens") or 0),
            "estimated_cost_usd": round(amount(row.get("estimated_cost_usd")), 6),
            "created_at": row.get("created_at"),
        })

    return {
        "total_calls": len(rows),
        "total_tokens": total_tokens,
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "estimated_cost_usd": round(total_cost, 6),
        "by_feature": grouped("feature"),
        "by_model": grouped("provider", "model"),
        "by_user": top_users,
        "recent": recent,
    }


@router.get("/stats")
async def get_system_stats(user=Depends(require_admin)) -> dict:
    workspaces = await sb_select("workspaces", columns="id,name,user_id,created_at")
    users = await _select_users_with_block()
    members = await sb_select("workspace_members", columns="id,workspace_id,user_id,permission_type,created_at")
    invitations = await sb_select("workspace_invitations", columns="id,workspace_id,email,status,created_at")
    upgrade_clicks = await sb_select("upgrade_clicks", columns="id")

    user_email_map = {u["id"]: u["email"] for u in users}
    workspace_name_map = {ws["id"]: (ws.get("name") or "Unnamed") for ws in workspaces}
    ai_usage_events = await _select_ai_usage_events()
    ai_usage = _rollup_ai_usage(ai_usage_events, user_email_map)

    sim_count = 0
    blueprint_count = 0
    validation_count = 0
    for ws in workspaces:
        ws_data = await sb_select("workspaces", filters=[("id", "eq", ws["id"])], columns="data", single=True)
        data = (ws_data or {}).get("data") or {}
        if isinstance(data, dict):
            sims = data.get("simulations") or []
            if isinstance(sims, list):
                sim_count += len(sims)
            bps = data.get("blueprints") or data.get("documents") or []
            if isinstance(bps, list):
                blueprint_count += len(bps)
            if data.get("decision") or data.get("idea_validation") or data.get("service_validation_history"):
                validation_count += 1

    return {
        "total_workspaces": len(workspaces),
        "total_users": len(users),
        "total_members": len(members),
        "total_invitations": len(invitations),
        "total_simulations": sim_count,
        "total_blueprints": blueprint_count,
        "total_validated_workspaces": validation_count,
        "total_upgrade_clicks": len(upgrade_clicks),
        "total_ai_calls": ai_usage["total_calls"],
        "total_ai_tokens": ai_usage["total_tokens"],
        "total_ai_cost_usd": ai_usage["estimated_cost_usd"],
        "ai_usage": ai_usage,
        "workspaces": [
            {
                "id": ws["id"],
                "name": ws.get("name") or "Unnamed",
                "owner_id": ws.get("user_id"),
                "owner_email": user_email_map.get(ws.get("user_id") or "", ""),
                "created_at": ws.get("created_at"),
            }
            for ws in workspaces
        ],
        "users": [
            {
                "id": u["id"],
                "email": u["email"],
                "created_at": u.get("created_at"),
                "is_blocked": bool(u.get("is_blocked", False)),
                "block_reason": u.get("block_reason"),
            }
            for u in users
        ],
        "members": [
            {
                "id": m["id"],
                "workspace_id": m["workspace_id"],
                "workspace_name": workspace_name_map.get(m["workspace_id"] or "", ""),
                "user_id": m["user_id"],
                "user_email": user_email_map.get(m["user_id"] or "", ""),
                "permission_type": m.get("permission_type"),
                "created_at": m.get("created_at"),
            }
            for m in members
        ],
        "invitations": [
            {
                "id": i["id"],
                "workspace_id": i["workspace_id"],
                "workspace_name": workspace_name_map.get(i["workspace_id"] or "", ""),
                "invited_email": i.get("email"),
                "status": i.get("status"),
                "created_at": i.get("created_at"),
            }
            for i in invitations
        ],
    }


@router.get("/workspaces")
async def list_all_workspaces(user=Depends(require_admin)) -> list:
    return await sb_select("workspaces", columns="id,name,created_at", order="created_at", desc=True)


@router.get("/users")
async def list_all_users(user=Depends(require_admin)) -> list:
    return await _select_users_with_block(order="created_at", desc=True)


@router.get("/waitlist")
async def list_plan_waitlist(user=Depends(require_admin)) -> list:
    try:
        return await sb_select(
            "plan_waitlist",
            columns="id,email,plan_key,billing_period,joined_at",
            order="joined_at",
            desc=True,
        )
    except Exception:
        return []


@router.get("/upgrade-clicks")
async def list_upgrade_clicks(user=Depends(require_admin)) -> list:
    return await sb_select(
        "upgrade_clicks",
        columns="id,user_id,email,feature,source,clicked_at",
        order="clicked_at",
        desc=True,
    )


@router.get("/mailing-list")
async def list_mailing_list(user=Depends(require_admin)) -> list:
    try:
        return await sb_select(
            "mailing_list",
            columns="id,email,source,subscribed_at",
            order="subscribed_at",
            desc=True,
        )
    except Exception:
        return []


@router.get("/module-interest")
async def list_module_interest(user=Depends(require_admin)) -> list:
    try:
        return await sb_select(
            "module_interest",
            columns="id,email,feature,clicked_at",
            order="clicked_at",
            desc=True,
        )
    except Exception:
        return []


@router.get("/support-messages")
async def list_support_messages(user=Depends(require_admin)) -> list:
    try:
        return await sb_select(
            "support_messages",
            columns="id,name,email,message,type,created_at",
            order="created_at",
            desc=True,
        )
    except Exception:
        return []


@router.get("/workspaces/{workspace_id}")
async def get_workspace_detail(workspace_id: str, user=Depends(require_admin)) -> dict:
    ws = await sb_select("workspaces", filters=[("id", "eq", workspace_id)], single=True)
    if not ws:
        raise HTTPException(status_code=404, detail="Workspace not found.")

    members = await sb_select(
        "workspace_members",
        filters=[("workspace_id", "eq", workspace_id)],
        columns="id,user_id,permission_type,role,created_at",
    )
    invitations = await sb_select(
        "workspace_invitations",
        filters=[("workspace_id", "eq", workspace_id)],
        columns="id,email,status,permission_type,created_at",
        order="created_at",
        desc=True,
    )

    user_ids = [m["user_id"] for m in members if m.get("user_id")]
    users_map: dict = {}
    if user_ids:
        users_list = await sb_select("users", filters=[("id", "in", user_ids)], columns="id,email")
        users_map = {u["id"]: u["email"] for u in users_list}

    owner = None
    if ws.get("user_id"):
        owner = await sb_select("users", filters=[("id", "eq", ws["user_id"])], columns="id,email", single=True)

    raw_data = ws.get("data") or {}
    data = raw_data if isinstance(raw_data, dict) else {}

    return {
        "id": ws["id"],
        "name": ws.get("name") or "Unnamed",
        "created_at": ws.get("created_at"),
        "owner_id": ws.get("user_id"),
        "owner_email": owner.get("email") if owner else None,
        "member_count": len(members),
        "invitation_count": len(invitations),
        "has_validation": bool(data.get("decision") or data.get("idea_validation")),
        "has_simulation": bool(data.get("simulations")),
        "members": [
            {
                "id": m["id"],
                "user_id": m["user_id"],
                "email": users_map.get(m["user_id"] or "", "Unknown"),
                "permission_type": m.get("permission_type"),
                "role": m.get("role", "member"),
                "created_at": m.get("created_at"),
            }
            for m in members
        ],
        "invitations": [
            {
                "id": i["id"],
                "email": i.get("email"),
                "status": i.get("status"),
                "permission_type": i.get("permission_type"),
                "created_at": i.get("created_at"),
            }
            for i in invitations
        ],
    }


@router.get("/users/{user_id}/restrictions")
async def get_user_restrictions(user_id: str, user=Depends(require_admin)) -> list:
    return await _select_restrictions(user_id)


@router.get("/users/{user_id}/full-data")
async def get_user_full_data(user_id: str, user=Depends(require_admin)) -> dict:
    target = await sb_select("users", filters=[("id", "eq", user_id)], single=True)
    if not target:
        raise HTTPException(status_code=404, detail="User not found.")

    workspaces = await sb_select(
        "workspaces",
        filters=[("user_id", "eq", user_id)],
        columns="id,name,data,created_at,updated_at",
        order="created_at",
        desc=True,
    )

    memberships = await sb_select(
        "workspace_members",
        filters=[("user_id", "eq", user_id)],
        columns="id,workspace_id,permission_type,created_at",
    )
    ws_ids = [m["workspace_id"] for m in memberships if m.get("workspace_id")]
    ws_names: dict = {}
    if ws_ids:
        ws_list = await sb_select("workspaces", filters=[("id", "in", ws_ids)], columns="id,name")
        ws_names = {w["id"]: (w.get("name") or "Unnamed") for w in ws_list}

    blueprints = await sb_select(
        "blueprint_documents",
        filters=[("user_id", "eq", user_id)],
        columns="id,type,title,company_name,created_at",
        order="created_at",
        desc=True,
    )

    upgrade_clicks = await sb_select(
        "upgrade_clicks",
        filters=[("email", "eq", target["email"])],
        columns="id,feature,source,clicked_at",
        order="clicked_at",
        desc=True,
    )

    restrictions = await _select_restrictions(user_id)

    workspace_summaries = []
    for ws in workspaces:
        data = ws.get("data") or {}
        if not isinstance(data, dict):
            data = {}
        sims = data.get("simulations") or []
        bps = data.get("blueprints") or data.get("documents") or []
        workspace_summaries.append({
            "id": ws["id"],
            "name": ws.get("name") or "Unnamed",
            "created_at": ws.get("created_at"),
            "updated_at": ws.get("updated_at"),
            "sim_count": len(sims) if isinstance(sims, list) else 0,
            "blueprint_count": len(bps) if isinstance(bps, list) else 0,
            "has_validation": bool(data.get("decision") or data.get("idea_validation")),
            "has_service_validation": bool(data.get("service_validation_history")),
        })

    return {
        "user": {
            "id": target["id"],
            "email": target["email"],
            "name": target.get("name"),
            "auth_provider": target.get("auth_provider"),
            "created_at": target.get("created_at"),
            "is_blocked": bool(target.get("is_blocked", False)),
            "block_reason": target.get("block_reason"),
        },
        "owned_workspaces": workspace_summaries,
        "memberships": [
            {
                "id": m["id"],
                "workspace_id": m["workspace_id"],
                "workspace_name": ws_names.get(m["workspace_id"], m["workspace_id"]),
                "permission_type": m.get("permission_type"),
                "created_at": m.get("created_at"),
            }
            for m in memberships
        ],
        "blueprint_documents": blueprints,
        "upgrade_clicks": upgrade_clicks,
        "platform_restrictions": restrictions,
    }


# ── Control endpoints ─────────────────────────────────────────────────────────

class BlockPayload(BaseModel):
    reason: Optional[str] = "Blocked by administrator"


@router.patch("/users/{user_id}/block")
async def block_user(
    user_id: str,
    payload: BlockPayload = Body(default=BlockPayload()),
    user=Depends(require_admin),
) -> dict:
    if user_id == user.get("id"):
        raise HTTPException(status_code=400, detail="Cannot block your own admin account.")
    try:
        result = await sb_update(
            "users",
            payload={"is_blocked": True, "block_reason": payload.reason or "Blocked by administrator"},
            filters=[("id", "eq", user_id)],
        )
        if not result:
            raise HTTPException(status_code=404, detail="User not found.")
        u = result[0]
        return {"id": u["id"], "email": u["email"], "is_blocked": True, "block_reason": u.get("block_reason")}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Migration required: run the is_blocked schema migration first. ({e})")


@router.patch("/users/{user_id}/unblock")
async def unblock_user(user_id: str, user=Depends(require_admin)) -> dict:
    try:
        result = await sb_update(
            "users",
            payload={"is_blocked": False, "block_reason": None},
            filters=[("id", "eq", user_id)],
        )
        if not result:
            raise HTTPException(status_code=404, detail="User not found.")
        u = result[0]
        return {"id": u["id"], "email": u["email"], "is_blocked": False, "block_reason": None}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Migration required: run the is_blocked schema migration first. ({e})")


class RestrictionPayload(BaseModel):
    module_key: str
    feature_key: Optional[str] = None


@router.post("/users/{user_id}/restrictions")
async def add_user_restriction(
    user_id: str,
    payload: RestrictionPayload,
    user=Depends(require_admin),
) -> dict:
    feature_key = payload.feature_key or ""
    try:
        existing = await sb_select(
            "user_platform_restrictions",
            filters=[
                ("user_id", "eq", user_id),
                ("module_key", "eq", payload.module_key),
                ("feature_key", "eq", feature_key),
            ],
            single=True,
        )
        if existing:
            return existing
        doc = {
            "id": str(uuid4()),
            "user_id": user_id,
            "module_key": payload.module_key,
            "feature_key": feature_key,
            "created_by": user.get("id"),
        }
        result = await sb_insert("user_platform_restrictions", doc)
        return result[0] if isinstance(result, list) else result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Migration required: run the user_platform_restrictions schema migration first. ({e})")


@router.delete("/users/{user_id}/restrictions/{restriction_id}", status_code=204, response_class=Response)
async def remove_user_restriction(
    user_id: str,
    restriction_id: str,
    user=Depends(require_admin),
) -> Response:
    try:
        await sb_delete(
            "user_platform_restrictions",
            filters=[("id", "eq", restriction_id), ("user_id", "eq", user_id)],
        )
    except Exception:
        pass
    return Response(status_code=204)


# ── Platform grants ───────────────────────────────────────────────────────────

async def _select_grants(user_id: str, columns: str = "id,module_key,feature_key,created_at") -> list:
    try:
        return await sb_select(
            "user_platform_grants",
            filters=[("user_id", "eq", user_id)],
            columns=columns,
            order="created_at",
        )
    except Exception:
        return []


@router.get("/users/{user_id}/grants")
async def get_user_grants(user_id: str, user=Depends(require_admin)) -> list:
    return await _select_grants(user_id)


@router.post("/users/{user_id}/grants")
async def add_user_grant(
    user_id: str,
    payload: RestrictionPayload,
    user=Depends(require_admin),
) -> dict:
    feature_key = payload.feature_key or ""
    try:
        existing = await sb_select(
            "user_platform_grants",
            filters=[
                ("user_id", "eq", user_id),
                ("module_key", "eq", payload.module_key),
                ("feature_key", "eq", feature_key),
            ],
            single=True,
        )
        if existing:
            return existing
        doc = {
            "id": str(uuid4()),
            "user_id": user_id,
            "module_key": payload.module_key,
            "feature_key": feature_key,
            "created_by": user.get("id"),
        }
        result = await sb_insert("user_platform_grants", doc)
        return result[0] if isinstance(result, list) else result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Run the user_platform_grants schema migration first. ({e})")


@router.delete("/users/{user_id}/grants/{grant_id}", status_code=204, response_class=Response)
async def remove_user_grant(
    user_id: str,
    grant_id: str,
    user=Depends(require_admin),
) -> Response:
    try:
        await sb_delete(
            "user_platform_grants",
            filters=[("id", "eq", grant_id), ("user_id", "eq", user_id)],
        )
    except Exception:
        pass
    return Response(status_code=204)


@router.delete("/users/{user_id}", status_code=204, response_class=Response)
async def delete_user(user_id: str, user=Depends(require_admin)) -> Response:
    if user_id == user.get("id"):
        raise HTTPException(status_code=400, detail="Cannot delete your own admin account.")
    await sb_delete("users", filters=[("id", "eq", user_id)])
    return Response(status_code=204)


@router.patch("/workspaces/{workspace_id}")
async def rename_workspace(
    workspace_id: str,
    payload: dict = Body(...),
    user=Depends(require_admin),
) -> dict:
    new_name = str(payload.get("name") or "").strip()
    if not new_name:
        raise HTTPException(status_code=400, detail="Name is required.")
    result = await sb_update(
        "workspaces",
        payload={"name": new_name},
        filters=[("id", "eq", workspace_id)],
    )
    if not result:
        raise HTTPException(status_code=404, detail="Workspace not found.")
    return {"id": workspace_id, "name": new_name}


@router.get("/workspaces/{workspace_id}/snapshots")
async def list_workspace_snapshots(workspace_id: str, user=Depends(require_admin)) -> list:
    try:
        from app.core.database import get_mongo_db
        from bson import ObjectId
        db = get_mongo_db()
        col = db["workspace_snapshots"]
        docs = await col.find(
            {"workspace_id": workspace_id},
            {"_id": 1, "workspace_name": 1, "created_at": 1},
        ).sort("created_at", -1).to_list(length=50)
        return [
            {"snapshot_id": str(d["_id"]), "ws_name": d.get("workspace_name") or "Unnamed", "saved_at": d.get("created_at")}
            for d in docs
        ]
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"MongoDB unavailable: {exc}")


@router.post("/workspaces/{workspace_id}/restore")
async def restore_workspace_snapshot(
    workspace_id: str,
    payload: dict = Body(...),
    user=Depends(require_admin),
) -> dict:
    snapshot_id = payload.get("snapshot_id")
    if not snapshot_id:
        raise HTTPException(status_code=400, detail="snapshot_id is required.")

    try:
        from app.core.database import get_mongo_db
        from bson import ObjectId
        db = get_mongo_db()
        col = db["workspace_snapshots"]
        snap = await col.find_one({"_id": ObjectId(snapshot_id), "workspace_id": workspace_id})
        if not snap:
            raise HTTPException(status_code=404, detail="Snapshot not found.")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"MongoDB unavailable: {exc}")

    ws = await sb_select("workspaces", filters=[("id", "eq", workspace_id)], single=True)
    if not ws:
        raise HTTPException(status_code=404, detail="Workspace not found.")

    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()

    # Save current state as a snapshot before overwriting
    try:
        from app.core.database import get_mongo_db
        db = get_mongo_db()
        await db["workspace_snapshots"].insert_one({
            "workspace_id": workspace_id,
            "workspace_name": ws.get("name") or "Unnamed",
            "data": ws.get("data") or {},
            "created_at": now,
        })
    except Exception:
        pass

    restored_data = snap.get("data") or {}
    restored_name = snap.get("workspace_name") or ws.get("name") or "Unnamed"

    await sb_update(
        "workspaces",
        payload={"data": restored_data, "name": restored_name, "updated_at": now},
        filters=[("id", "eq", workspace_id)],
    )
    return {"restored": True, "ws_name": restored_name, "saved_at": snap.get("created_at")}


@router.delete("/workspaces/{workspace_id}", status_code=204, response_class=Response)
async def delete_workspace(workspace_id: str, user=Depends(require_admin)) -> Response:
    await sb_delete("workspaces", filters=[("id", "eq", workspace_id)])
    return Response(status_code=204)


@router.delete("/members/{member_id}", status_code=204, response_class=Response)
async def remove_workspace_member(member_id: str, user=Depends(require_admin)) -> Response:
    await sb_delete("workspace_members", filters=[("id", "eq", member_id)])
    return Response(status_code=204)


@router.delete("/upgrade-clicks/{record_id}", status_code=204, response_class=Response)
async def delete_upgrade_click(record_id: str, user=Depends(require_admin)) -> Response:
    await sb_delete("upgrade_clicks", filters=[("id", "eq", record_id)])
    return Response(status_code=204)


@router.delete("/module-interest/{record_id}", status_code=204, response_class=Response)
async def delete_module_interest(record_id: str, user=Depends(require_admin)) -> Response:
    await sb_delete("module_interest", filters=[("id", "eq", record_id)])
    return Response(status_code=204)


@router.delete("/mailing-list/{record_id}", status_code=204, response_class=Response)
async def delete_mailing_list_entry(record_id: str, user=Depends(require_admin)) -> Response:
    await sb_delete("mailing_list", filters=[("id", "eq", record_id)])
    return Response(status_code=204)


@router.delete("/support-messages/{record_id}", status_code=204, response_class=Response)
async def delete_support_message(record_id: str, user=Depends(require_admin)) -> Response:
    await sb_delete("support_messages", filters=[("id", "eq", record_id)])
    return Response(status_code=204)


@router.patch("/invitations/{invitation_id}/revoke")
async def revoke_workspace_invitation(invitation_id: str, user=Depends(require_admin)) -> dict:
    result = await sb_update(
        "workspace_invitations",
        payload={"status": "revoked"},
        filters=[("id", "eq", invitation_id)],
    )
    if not result:
        raise HTTPException(status_code=404, detail="Invitation not found.")
    return result[0]


TRIAL_DAYS = 14


@router.get("/users/{user_id}/subscription")
async def get_user_subscription(user_id: str, user=Depends(require_admin)) -> dict:
    try:
        sub = await sb_select("user_subscriptions", filters=[("user_id", "eq", user_id)], single=True)
    except Exception:
        sub = None
    if sub:
        return sub
    # Fall back to deriving from account creation date
    user_row = await sb_select("users", filters=[("id", "eq", user_id)], single=True)
    if not user_row:
        raise HTTPException(status_code=404, detail="User not found.")
    created_at_str = user_row.get("created_at", "")
    try:
        created_at = datetime.fromisoformat(created_at_str.replace("Z", "+00:00"))
        trial_end = created_at + timedelta(days=TRIAL_DAYS)
        now = datetime.now(timezone.utc)
        return {
            "user_id": user_id,
            "plan_key": "explorer",
            "status": "trial" if now < trial_end else "expired",
            "current_period_end": trial_end.isoformat(),
            "trial_started_at": created_at_str,
            "_derived": True,
        }
    except Exception:
        return {"user_id": user_id, "plan_key": "explorer", "status": "expired", "_derived": True}


@router.post("/users/{user_id}/renew-trial")
async def renew_user_trial(user_id: str, user=Depends(require_admin)) -> dict:
    user_row = await sb_select("users", filters=[("id", "eq", user_id)], single=True)
    if not user_row:
        raise HTTPException(status_code=404, detail="User not found.")
    now = datetime.now(timezone.utc)
    trial_end = now + timedelta(days=TRIAL_DAYS)
    await sb_upsert(
        "user_subscriptions",
        payload={
            "user_id": user_id,
            "plan_key": "explorer",
            "billing_period": "monthly",
            "status": "trial",
            "stripe_subscription_id": None,
            "stripe_customer_id": None,
            "current_period_start": now.isoformat(),
            "current_period_end": trial_end.isoformat(),
            "trial_started_at": now.isoformat(),
            "cancelled_at": None,
            "updated_at": now.isoformat(),
        },
        on_conflict="user_id",
    )
    return {"renewed": True, "trial_end": trial_end.isoformat()}


VALID_PLAN_KEYS = {"explorer", "starter_insight", "decision_engine", "growth_navigator", "strategic_business_os"}
VALID_STATUSES = {"active", "trial", "expired", "grandfathered"}
VALID_BILLING_PERIODS = {"monthly", "annual"}


@router.patch("/users/{user_id}/plan")
async def set_user_plan(user_id: str, payload: dict, user=Depends(require_admin)) -> dict:
    plan_key = (payload.get("plan_key") or "").strip()
    billing_period = (payload.get("billing_period") or "monthly").strip()
    new_status = (payload.get("status") or "active").strip()

    if plan_key not in VALID_PLAN_KEYS:
        raise HTTPException(status_code=400, detail=f"Invalid plan_key. Must be one of: {', '.join(sorted(VALID_PLAN_KEYS))}")
    if billing_period not in VALID_BILLING_PERIODS:
        raise HTTPException(status_code=400, detail="billing_period must be 'monthly' or 'annual'.")
    if new_status not in VALID_STATUSES:
        raise HTTPException(status_code=400, detail=f"Invalid status. Must be one of: {', '.join(sorted(VALID_STATUSES))}")

    user_row = await sb_select("users", filters=[("id", "eq", user_id)], single=True)
    if not user_row:
        raise HTTPException(status_code=404, detail="User not found.")

    now = datetime.now(timezone.utc)
    if new_status == "trial":
        period_end = now + timedelta(days=TRIAL_DAYS)
    elif new_status == "active":
        months = 12 if billing_period == "annual" else 1
        period_end = now + timedelta(days=365 if billing_period == "annual" else 31)
    else:
        period_end = now

    await sb_upsert(
        "user_subscriptions",
        payload={
            "user_id": user_id,
            "plan_key": plan_key,
            "billing_period": billing_period,
            "status": new_status,
            "stripe_subscription_id": None,
            "stripe_customer_id": None,
            "current_period_start": now.isoformat(),
            "current_period_end": period_end.isoformat(),
            "cancelled_at": None,
            "updated_at": now.isoformat(),
        },
        on_conflict="user_id",
    )
    updated = await sb_select("user_subscriptions", filters=[("user_id", "eq", user_id)], single=True)
    return updated or {"user_id": user_id, "plan_key": plan_key, "billing_period": billing_period, "status": new_status}
