from __future__ import annotations

import logging
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import RedirectResponse

from app.core.config import get_settings
from app.core.supabase import sb_insert, sb_select, sb_update
from app.modules.referral import service as svc
from app.modules.referral.schemas import (
    AdminAdjustmentRequest,
    AdminPayoutDecision,
    EnrolRequest,
    PayoutProfileRequest,
    PayoutRequestCreate,
    RecordClickRequest,
    RecordClickResponse,
)
from app.shared.auth.deps import get_current_user, get_optional_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/referrals", tags=["referrals"])
click_router = APIRouter(tags=["referrals"])  # for /r/{code}

ADMIN_EMAIL = "tech.support@enterprateai.com"


def _require_admin(user=Depends(get_current_user)):
    if user.get("email") != ADMIN_EMAIL:
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


def _frontend_url() -> str:
    settings = get_settings()
    url = settings.frontend_url
    if isinstance(url, list):
        url = url[0]
    return str(url).rstrip("/")


# ── Public: click capture ─────────────────────────────────────────────────────

@click_router.get("/r/{code}", include_in_schema=False)
async def referral_click_redirect(code: str, request: Request):
    """Server-side click capture — validate code, record event, redirect."""
    participant = await svc.get_participant_by_code(code)
    if not participant:
        return RedirectResponse(url=_frontend_url() + "/register", status_code=302)

    config = await svc.get_active_config()
    expires_at = (
        datetime.now(timezone.utc) + timedelta(days=config["attribution_days"])
    ).isoformat()

    # Pseudonymise IP for privacy
    raw_ip = request.client.host if request.client else ""
    ip_hash = _hash(raw_ip) if raw_ip else None

    click_row = {
        "referral_code": code,
        "participant_user_id": participant["user_id"],
        "expires_at": expires_at,
        "landing_path": str(request.url.path),
        "ip_hash": ip_hash,
    }
    inserted = await sb_insert("referral_clicks", click_row)
    click_id = (inserted[0] if isinstance(inserted, list) else inserted)["id"]

    # Redirect to frontend with click_id so it can be stored client-side
    redirect_url = (
        f"{_frontend_url()}/register?ref_click={click_id}&ref_code={code}"
    )
    return RedirectResponse(url=redirect_url, status_code=302)


@router.post("/click", response_model=RecordClickResponse)
async def record_click(body: RecordClickRequest):
    """Called by the frontend /r/:code page to record a click and get click_id."""
    participant = await svc.get_participant_by_code(body.code)
    if not participant:
        raise HTTPException(status_code=404, detail="Referral code not found or inactive")

    config = await svc.get_active_config()
    expires_at = (
        datetime.now(timezone.utc) + timedelta(days=config["attribution_days"])
    ).isoformat()

    click_row = {
        "referral_code": body.code,
        "participant_user_id": participant["user_id"],
        "expires_at": expires_at,
        "landing_path": body.landing_path,
    }
    inserted = await sb_insert("referral_clicks", click_row)
    click = inserted[0] if isinstance(inserted, list) else inserted

    return RecordClickResponse(
        click_id=click["id"],
        expires_at=expires_at,
        referral_code=body.code,
    )


@router.get("/terms")
async def get_terms():
    terms = await svc.get_active_terms()
    if not terms:
        raise HTTPException(status_code=404, detail="Terms not yet configured")
    return terms


# ── Authenticated: participant endpoints ──────────────────────────────────────

@router.post("/enrol")
async def enrol(body: EnrolRequest, user=Depends(get_current_user)):
    user_id = user["id"]

    existing = await sb_select(
        "referral_participants",
        filters=[("user_id", "eq", user_id)],
        single=True,
    )
    if existing:
        if existing["status"] == "opted_out":
            # Re-join: reactivate
            await sb_update(
                "referral_participants",
                filters=[("user_id", "eq", user_id)],
                payload={"status": "active", "opted_out_at": None},
            )
            return {"status": "active", "rejoined": True}
        return {"status": existing["status"], "already_enrolled": True}

    terms = await svc.get_active_terms()
    if not terms or terms["version"] != body.terms_version:
        raise HTTPException(
            status_code=400,
            detail=f"Please accept the current terms version: {terms['version'] if terms else 'unavailable'}",
        )

    # Check for reacceptance requirement
    if terms.get("requires_reacceptance") and body.terms_version != terms["version"]:
        raise HTTPException(status_code=400, detail="Terms reacceptance required")

    code = await svc.get_or_create_code(user_id)

    row = {
        "user_id": user_id,
        "referral_code": code,
        "status": "active",
        "terms_version_id": terms["id"],
        "terms_accepted_at": datetime.now(timezone.utc).isoformat(),
    }
    await sb_insert("referral_participants", row)
    await svc.write_audit_log(
        actor_user_id=user_id,
        actor_role="participant",
        action="enrol",
        entity_type="referral_participant",
        entity_id=user_id,
        after_state={"status": "active", "terms_version": body.terms_version},
    )

    frontend = _frontend_url()
    return {
        "status": "active",
        "referral_code": code,
        "referral_link": f"{frontend}/r/{code}",
    }


@router.get("/me")
async def get_my_referral(user=Depends(get_current_user)):
    user_id = user["id"]
    participant = await sb_select(
        "referral_participants",
        filters=[("user_id", "eq", user_id)],
        single=True,
    )

    if not participant:
        terms = await svc.get_active_terms()
        return {
            "enrolled": False,
            "terms": {"version": terms["version"], "content": terms["content"]} if terms else None,
        }

    # Run reward approval for this user
    await svc.approve_due_rewards(user_id)

    balances = await svc.get_balances(user_id)
    config = await svc.get_active_config()
    frontend = _frontend_url()
    code = participant["referral_code"]

    # Funnel stats
    clicks = await sb_select(
        "referral_clicks",
        filters=[("participant_user_id", "eq", user_id)],
    )
    attributions = await sb_select(
        "referral_attributions",
        filters=[("referrer_user_id", "eq", user_id)],
    )
    attr_ids = [a["id"] for a in attributions]
    conversions = []
    if attr_ids:
        for attr_id in attr_ids:
            c = await sb_select(
                "referral_conversions",
                filters=[("attribution_id", "eq", attr_id)],
            )
            conversions.extend(c)

    payout_profile = await sb_select(
        "payout_profiles",
        filters=[("user_id", "eq", user_id)],
        single=True,
    )

    return {
        "enrolled": True,
        "status": participant["status"],
        "referral_code": code,
        "referral_link": f"{frontend}/r/{code}",
        "terms_accepted_at": participant.get("terms_accepted_at"),
        "joined_at": participant.get("joined_at"),
        "funnel": {
            "clicks": len(clicks),
            "attributed_signups": len(attributions),
            "paying_referrals": len([c for c in conversions if c["status"] == "active"]),
        },
        "balances": balances,
        "threshold_minor": config["threshold_minor"],
        "payout_profile": _mask_profile(payout_profile) if payout_profile else None,
    }


@router.get("/transactions")
async def get_transactions(
    page: int = 1,
    page_size: int = 25,
    user=Depends(get_current_user),
):
    user_id = user["id"]
    _check_enrolled(await sb_select(
        "referral_participants",
        filters=[("user_id", "eq", user_id)],
        single=True,
    ))

    entries = await sb_select(
        "referral_reward_entries",
        filters=[("participant_user_id", "eq", user_id)],
        order="created_at",
        desc=True,
    )

    total = len(entries)
    start = (page - 1) * page_size
    page_entries = entries[start : start + page_size]

    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "items": [_safe_entry(e) for e in page_entries],
    }


@router.get("/payout-profile")
async def get_payout_profile(user=Depends(get_current_user)):
    profile = await sb_select(
        "payout_profiles",
        filters=[("user_id", "eq", user["id"])],
        single=True,
    )
    return _mask_profile(profile) if profile else {}


@router.put("/payout-profile")
async def upsert_payout_profile(
    body: PayoutProfileRequest,
    user=Depends(get_current_user),
):
    user_id = user["id"]
    _check_enrolled(await sb_select(
        "referral_participants",
        filters=[("user_id", "eq", user_id)],
        single=True,
    ))

    # Build masked display values and store full token as JSON
    full_token: dict = {}
    account_number_masked = None
    sort_code_masked = None
    paypal_email_masked = None

    if body.method == "bank_transfer":
        if body.account_number:
            full_token["account_number"] = body.account_number
            account_number_masked = "****" + body.account_number[-4:] if len(body.account_number) >= 4 else "****"
        if body.sort_code:
            full_token["sort_code"] = body.sort_code
            sort_code_masked = "**-**-" + body.sort_code[-2:] if len(body.sort_code) >= 2 else "**-**-**"
        if body.account_name:
            full_token["account_name"] = body.account_name
    elif body.method == "paypal":
        if body.paypal_email:
            full_token["paypal_email"] = body.paypal_email
            parts = body.paypal_email.split("@")
            paypal_email_masked = parts[0][:2] + "***@" + parts[1] if len(parts) == 2 else "***"

    import json as _json
    row = {
        "user_id": user_id,
        "method": body.method,
        "account_name": body.account_name,
        "account_number_masked": account_number_masked,
        "sort_code_masked": sort_code_masked,
        "paypal_email_masked": paypal_email_masked,
        "provider_token": _json.dumps(full_token),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }

    existing = await sb_select(
        "payout_profiles",
        filters=[("user_id", "eq", user_id)],
        single=True,
    )
    if existing:
        await sb_update(
            "payout_profiles",
            filters=[("user_id", "eq", user_id)],
            payload=row,
        )
    else:
        await sb_insert("payout_profiles", row)

    return {"saved": True}


@router.post("/payouts")
async def request_payout(
    body: PayoutRequestCreate,
    user=Depends(get_current_user),
):
    user_id = user["id"]
    participant = await sb_select(
        "referral_participants",
        filters=[("user_id", "eq", user_id)],
        single=True,
    )
    _check_enrolled(participant)

    if participant["status"] != "active":
        raise HTTPException(status_code=403, detail="Your account is not eligible for payouts")

    # Run approval for this user first
    await svc.approve_due_rewards(user_id)

    balances = await svc.get_balances(user_id)
    config = await svc.get_active_config()
    payable = balances["payable_minor"]

    if payable < config["threshold_minor"]:
        raise HTTPException(
            status_code=400,
            detail=f"Payable balance £{payable / 100:.2f} is below the £{config['threshold_minor'] / 100:.2f} minimum threshold",
        )

    # Check payout profile exists
    profile = await sb_select(
        "payout_profiles",
        filters=[("user_id", "eq", user_id)],
        single=True,
    )
    if not profile:
        raise HTTPException(status_code=400, detail="Please add your payout details first")

    # Check no active payout request already exists
    active = await sb_select(
        "payout_requests",
        filters=[("participant_user_id", "eq", user_id)],
    )
    active_statuses = {"requested", "under_review", "approved", "processing"}
    if any(p["status"] in active_statuses for p in active):
        raise HTTPException(status_code=409, detail="A payout request is already in progress")

    import json as _json
    idem_key = body.idempotency_key or f"payout_{user_id}_{uuid.uuid4().hex}"
    payout_row = {
        "participant_user_id": user_id,
        "amount_minor": payable,
        "currency": "GBP",
        "status": "requested",
        "payout_profile_snapshot": _json.dumps(_mask_profile(profile)),
        "idempotency_key": idem_key,
        "requested_at": datetime.now(timezone.utc).isoformat(),
    }
    inserted = await sb_insert("payout_requests", payout_row)
    payout = inserted[0] if isinstance(inserted, list) else inserted
    payout_id = payout["id"]

    # Allocate approved reward entries to this payout (atomic reservation)
    entries = await sb_select(
        "referral_reward_entries",
        filters=[("participant_user_id", "eq", user_id), ("status", "eq", "approved")],
        order="created_at",
    )
    remaining = payable
    for e in entries:
        if remaining <= 0:
            break
        alloc = min(e["amount_minor"], remaining)
        if alloc <= 0:
            continue
        await sb_insert(
            "payout_allocations",
            {
                "payout_request_id": payout_id,
                "reward_entry_id": e["id"],
                "allocated_minor": alloc,
            },
        )
        remaining -= alloc

    await svc.write_audit_log(
        actor_user_id=user_id,
        actor_role="participant",
        action="payout_requested",
        entity_type="payout_request",
        entity_id=payout_id,
        after_state={"amount_minor": payable, "status": "requested"},
    )

    return {
        "payout_id": payout_id,
        "amount_minor": payable,
        "amount_display": f"£{payable / 100:.2f}",
        "status": "requested",
    }


@router.post("/opt-out")
async def opt_out(user=Depends(get_current_user)):
    user_id = user["id"]
    participant = await sb_select(
        "referral_participants",
        filters=[("user_id", "eq", user_id)],
        single=True,
    )
    _check_enrolled(participant)

    await sb_update(
        "referral_participants",
        filters=[("user_id", "eq", user_id)],
        payload={
            "status": "opted_out",
            "opted_out_at": datetime.now(timezone.utc).isoformat(),
        },
    )
    await svc.write_audit_log(
        actor_user_id=user_id,
        actor_role="participant",
        action="opt_out",
        entity_type="referral_participant",
        entity_id=user_id,
    )
    return {"status": "opted_out"}


# ── Admin endpoints ───────────────────────────────────────────────────────────

@router.get("/admin/stats")
async def admin_stats(admin=Depends(_require_admin)):
    participants = await sb_select("referral_participants", filters=[])
    entries = await sb_select("referral_reward_entries", filters=[])
    payouts = await sb_select("payout_requests", filters=[])

    total_pending = sum(e["amount_minor"] for e in entries if e["status"] == "pending" and e["amount_minor"] > 0)
    total_approved = sum(e["amount_minor"] for e in entries if e["status"] == "approved")
    total_paid = sum(p["amount_minor"] for p in payouts if p["status"] == "paid")

    return {
        "participants": {
            "total": len(participants),
            "active": len([p for p in participants if p["status"] == "active"]),
            "opted_out": len([p for p in participants if p["status"] == "opted_out"]),
            "suspended": len([p for p in participants if p["status"] == "suspended"]),
        },
        "rewards": {
            "total_entries": len(entries),
            "pending_minor": total_pending,
            "approved_minor": total_approved,
            "outstanding_liability_minor": total_approved - total_paid,
        },
        "payouts": {
            "total": len(payouts),
            "requested": len([p for p in payouts if p["status"] == "requested"]),
            "paid": len([p for p in payouts if p["status"] == "paid"]),
            "paid_minor": total_paid,
        },
    }


@router.get("/admin/participants")
async def admin_participants(
    page: int = 1,
    page_size: int = 50,
    status: str | None = None,
    admin=Depends(_require_admin),
):
    filters = []
    if status:
        filters.append(("status", "eq", status))
    rows = await sb_select("referral_participants", filters=filters, order="joined_at", desc=True)
    total = len(rows)
    start = (page - 1) * page_size
    return {"total": total, "items": rows[start : start + page_size]}


@router.get("/admin/payouts")
async def admin_payouts(
    status: str | None = None,
    admin=Depends(_require_admin),
):
    filters = []
    if status:
        filters.append(("status", "eq", status))
    rows = await sb_select("payout_requests", filters=filters, order="requested_at", desc=True)
    return {"total": len(rows), "items": rows}


@router.patch("/admin/payouts/{payout_id}")
async def admin_decide_payout(
    payout_id: str,
    body: AdminPayoutDecision,
    admin=Depends(_require_admin),
):
    payout = await sb_select(
        "payout_requests",
        filters=[("id", "eq", payout_id)],
        single=True,
    )
    if not payout:
        raise HTTPException(status_code=404, detail="Payout not found")

    valid_transitions = {
        "approve": ("requested", "under_review", "action_required"),
        "reject": ("requested", "under_review", "action_required"),
        "action_required": ("requested", "under_review"),
        "mark_paid": ("approved", "processing"),
    }
    allowed_from = valid_transitions.get(body.action)
    if not allowed_from or payout["status"] not in allowed_from:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot '{body.action}' a payout in status '{payout['status']}'",
        )

    status_map = {
        "approve": "approved",
        "reject": "rejected",
        "action_required": "action_required",
        "mark_paid": "paid",
    }
    new_status = status_map[body.action]
    now_iso = datetime.now(timezone.utc).isoformat()
    updates: dict = {
        "status": new_status,
        "reviewer_user_id": admin["id"],
        "review_reason": body.reason,
        "reviewed_at": now_iso,
    }
    if new_status == "paid":
        updates["paid_at"] = now_iso
        if body.provider_reference:
            updates["provider_reference"] = body.provider_reference
    if new_status == "rejected":
        updates["failed_at"] = now_iso

    await sb_update("payout_requests", filters=[("id", "eq", payout_id)], payload=updates)

    await svc.write_audit_log(
        actor_user_id=admin["id"],
        actor_role="admin",
        action=f"payout_{body.action}",
        entity_type="payout_request",
        entity_id=payout_id,
        before_state={"status": payout["status"]},
        after_state={"status": new_status},
        reason=body.reason,
    )
    return {"payout_id": payout_id, "new_status": new_status}


@router.post("/admin/adjustments")
async def admin_adjustment(
    body: AdminAdjustmentRequest,
    admin=Depends(_require_admin),
):
    participant = await sb_select(
        "referral_participants",
        filters=[("user_id", "eq", body.participant_user_id)],
        single=True,
    )
    if not participant:
        raise HTTPException(status_code=404, detail="Participant not found")

    # Adjustments need a dummy attribution (use most recent)
    attributions = await sb_select(
        "referral_attributions",
        filters=[("referrer_user_id", "eq", body.participant_user_id)],
        order="attributed_at",
        desc=True,
        limit=1,
    )
    if not attributions:
        raise HTTPException(
            status_code=400,
            detail="Cannot adjust: participant has no attributions to link the entry to",
        )

    idem_key = f"adj_{admin['id']}_{uuid.uuid4().hex}"
    row = {
        "participant_user_id": body.participant_user_id,
        "attribution_id": attributions[0]["id"],
        "type": "adjustment",
        "amount_minor": body.amount_minor,
        "currency": "GBP",
        "status": "approved",
        "idempotency_key": idem_key,
        "calc_snapshot": {"category": body.category, "reason": body.reason, "admin": admin["id"]},
        "approved_at": datetime.now(timezone.utc).isoformat(),
        "available_at": datetime.now(timezone.utc).isoformat(),
    }
    inserted = await sb_insert("referral_reward_entries", row)
    entry = inserted[0] if isinstance(inserted, list) else inserted

    await svc.write_audit_log(
        actor_user_id=admin["id"],
        actor_role="admin",
        action="adjustment",
        entity_type="referral_reward_entry",
        entity_id=entry["id"],
        after_state={"amount_minor": body.amount_minor, "category": body.category},
        reason=body.reason,
    )
    return {"entry_id": entry["id"], "amount_minor": body.amount_minor}


@router.get("/admin/audit")
async def admin_audit(
    page: int = 1,
    page_size: int = 50,
    entity_type: str | None = None,
    admin=Depends(_require_admin),
):
    filters = []
    if entity_type:
        filters.append(("entity_type", "eq", entity_type))
    rows = await sb_select("referral_audit_logs", filters=filters, order="created_at", desc=True)
    total = len(rows)
    start = (page - 1) * page_size
    return {"total": total, "items": rows[start : start + page_size]}


@router.get("/admin/config")
async def admin_get_config(admin=Depends(_require_admin)):
    return await svc.get_active_config()


@router.post("/admin/approve-pending")
async def admin_approve_pending(admin=Depends(_require_admin)):
    """Manually trigger hold-period approval for all eligible rewards."""
    count = await svc.approve_due_rewards()
    return {"approved_count": count}


# ── Private helpers ───────────────────────────────────────────────────────────

def _check_enrolled(participant: dict | None):
    if not participant:
        raise HTTPException(status_code=404, detail="You have not joined the referral programme")


def _mask_profile(profile: dict | None) -> dict:
    if not profile:
        return {}
    return {
        "id": profile.get("id"),
        "method": profile.get("method"),
        "account_name": profile.get("account_name"),
        "account_number_masked": profile.get("account_number_masked"),
        "sort_code_masked": profile.get("sort_code_masked"),
        "paypal_email_masked": profile.get("paypal_email_masked"),
        "verified": profile.get("verified", False),
        "updated_at": profile.get("updated_at"),
    }


def _safe_entry(e: dict) -> dict:
    return {
        "id": e.get("id"),
        "type": e.get("type"),
        "amount_minor": e.get("amount_minor"),
        "currency": e.get("currency", "GBP"),
        "status": e.get("status"),
        "available_at": e.get("available_at"),
        "approved_at": e.get("approved_at"),
        "created_at": e.get("created_at"),
    }


def _hash(value: str) -> str:
    import hashlib
    return hashlib.sha256(value.encode()).hexdigest()[:16]
