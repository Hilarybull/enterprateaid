from __future__ import annotations

import logging
import uuid
from contextlib import asynccontextmanager
from typing import Any

import anyio
from fastapi import HTTPException

from app.core.supabase import get_supabase_client, sb_select

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# RPC helpers (call stored Postgres functions for atomic operations)
# ---------------------------------------------------------------------------

def _rpc_sync(fn_name: str, params: dict) -> Any:
    client = get_supabase_client()
    res = client.rpc(fn_name, params).execute()
    return res.data


async def _rpc(fn_name: str, params: dict) -> Any:
    return await anyio.to_thread.run_sync(lambda: _rpc_sync(fn_name, params))


# ---------------------------------------------------------------------------
# Wallet / balance
# ---------------------------------------------------------------------------

async def get_wallet(user_id: str) -> dict | None:
    rows = await sb_select(
        "credit_wallets",
        filters=[("user_id", "eq", user_id)],
        single=True,
    )
    return rows


async def ensure_wallet(user_id: str) -> dict:
    """Return existing wallet or create a new empty one."""
    wallet = await get_wallet(user_id)
    if wallet:
        return wallet

    result = await _rpc("grant_credits", {
        "p_user_id": user_id,
        "p_amount": 0,
        "p_type": "allocation",
        "p_reason": "Wallet initialised",
        "p_next_reset_at": None,
    })
    wallet = await get_wallet(user_id)
    return wallet  # type: ignore[return-value]


async def get_balance(user_id: str) -> int:
    wallet = await get_wallet(user_id)
    return wallet["available_credits"] if wallet else 0


# ---------------------------------------------------------------------------
# Feature config
# ---------------------------------------------------------------------------

async def get_feature_config(feature_code: str) -> dict | None:
    return await sb_select(
        "credit_feature_config",
        filters=[("feature_code", "eq", feature_code)],
        single=True,
    )


async def get_all_features() -> list[dict]:
    return await sb_select(
        "credit_feature_config",
        filters=[("enabled", "eq", True)],
        order="feature_code",
    )


# ---------------------------------------------------------------------------
# Atomic reserve / commit / release
# ---------------------------------------------------------------------------

async def reserve_credits(
    user_id: str,
    feature_code: str,
    generation_id: str | None = None,
) -> dict:
    """
    Reserve credits for a feature. Returns:
      {"ok": True, "transaction_id": ..., "generation_id": ...}  on success
      {"ok": False, "error": "INSUFFICIENT_CREDITS", "available": N, "required": N}
      {"ok": False, "error": "WALLET_NOT_FOUND"}
      {"ok": False, "error": "FEATURE_NOT_FOUND"}
      {"ok": False, "error": "FEATURE_DISABLED"}
    """
    config = await get_feature_config(feature_code)
    if not config:
        return {"ok": False, "error": "FEATURE_NOT_FOUND"}
    if not config["enabled"]:
        return {"ok": False, "error": "FEATURE_DISABLED"}

    gen_id = generation_id or str(uuid.uuid4())
    idempotency_key = f"{user_id}:{feature_code}:{gen_id}"

    result = await _rpc("reserve_credits", {
        "p_user_id": user_id,
        "p_feature_code": feature_code,
        "p_credit_cost": config["credit_cost"],
        "p_generation_id": gen_id,
        "p_idempotency_key": idempotency_key,
    })

    if isinstance(result, dict):
        result["generation_id"] = gen_id
        result["credit_cost"] = config["credit_cost"]
    return result


async def commit_credits(generation_id: str, user_id: str, feature_code: str) -> dict:
    """Confirm a successful AI generation — finalize credit deduction."""
    idempotency_key = f"{user_id}:{feature_code}:{generation_id}"
    return await _rpc("commit_credits", {
        "p_generation_id": generation_id,
        "p_idempotency_key": idempotency_key,
    })


async def release_credits(generation_id: str, user_id: str, feature_code: str) -> dict:
    """Return held credits if generation failed."""
    idempotency_key = f"{user_id}:{feature_code}:{generation_id}"
    return await _rpc("release_credits", {
        "p_generation_id": generation_id,
        "p_idempotency_key": idempotency_key,
    })


# ---------------------------------------------------------------------------
# Grant credits (allocation / promotion / admin)
# ---------------------------------------------------------------------------

async def grant_credits(
    user_id: str,
    amount: int,
    grant_type: str = "allocation",
    reason: str = "Manual grant",
    next_reset_at: str | None = None,
) -> dict:
    return await _rpc("grant_credits", {
        "p_user_id": user_id,
        "p_amount": amount,
        "p_type": grant_type,
        "p_reason": reason,
        "p_next_reset_at": next_reset_at,
    })


# ---------------------------------------------------------------------------
# Transaction history
# ---------------------------------------------------------------------------

async def get_transactions(user_id: str, limit: int = 50) -> list[dict]:
    return await sb_select(
        "credit_transactions",
        filters=[("user_id", "eq", user_id)],
        order="created_at",
        desc=True,
        limit=limit,
    )


# ---------------------------------------------------------------------------
# Check credits (non-atomic, for pre-flight UI display only)
# ---------------------------------------------------------------------------

async def check_credits(user_id: str, feature_code: str) -> dict:
    """
    Non-atomic check: returns whether the user can afford the feature.
    Do NOT use this as the actual gate — use reserve_credits for that.
    """
    config = await get_feature_config(feature_code)
    if not config:
        return {"can_afford": False, "reason": "FEATURE_NOT_FOUND"}

    balance = await get_balance(user_id)
    cost = config["credit_cost"]
    return {
        "can_afford": balance >= cost,
        "available": balance,
        "required": cost,
        "feature_code": feature_code,
    }


# ---------------------------------------------------------------------------
# Credit guard context manager
# ---------------------------------------------------------------------------

@asynccontextmanager
async def credit_guard(user_id: str, feature_code: str):
    """
    Usage:
        async with credit_guard(user_id, "idea_validation"):
            result = await run_ai_call(...)

    Atomically reserves credits before the AI call, commits on success,
    releases on failure. Raises HTTP 402 if the user has insufficient credits.
    """
    gen_id = str(uuid.uuid4())
    reservation = await reserve_credits(user_id, feature_code, gen_id)

    if not reservation.get("ok"):
        err = reservation.get("error", "UNKNOWN")
        if err == "INSUFFICIENT_CREDITS":
            available = reservation.get("available", 0)
            required = reservation.get("required", 0)
            raise HTTPException(
                status_code=402,
                detail={
                    "error": "INSUFFICIENT_CREDITS",
                    "message": f"Not enough credits. You have {available} credits but this feature requires {required}.",
                    "available": available,
                    "required": required,
                    "feature_code": feature_code,
                },
            )
        if err == "WALLET_NOT_FOUND":
            # Auto-provision wallet (first use)
            await ensure_wallet(user_id)
            reservation = await reserve_credits(user_id, feature_code, gen_id)
            if not reservation.get("ok"):
                raise HTTPException(
                    status_code=402,
                    detail={"error": reservation.get("error"), "feature_code": feature_code},
                )
        else:
            raise HTTPException(
                status_code=402,
                detail={"error": err, "feature_code": feature_code},
            )

    try:
        yield gen_id
    except Exception:
        await release_credits(gen_id, user_id, feature_code)
        raise
    else:
        await commit_credits(gen_id, user_id, feature_code)
