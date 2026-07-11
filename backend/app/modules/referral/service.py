from __future__ import annotations

import hashlib
import json
import logging
import math
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from app.core.supabase import sb_insert, sb_select, sb_update

logger = logging.getLogger(__name__)


# ── Config / Terms helpers ────────────────────────────────────────────────────

async def get_active_config() -> dict:
    rows = await sb_select(
        "programme_config_versions",
        filters=[("is_active", "eq", True)],
        order="effective_at",
        desc=True,
        limit=1,
    )
    if rows:
        return rows[0]
    # hard-coded fallback so the system never breaks if table is empty
    return {
        "id": None,
        "rate_bps": 500,
        "threshold_minor": 5000,
        "hold_days": 30,
        "attribution_days": 30,
        "recurring": True,
    }


async def get_active_terms() -> dict | None:
    rows = await sb_select(
        "referral_terms_versions",
        order="effective_at",
        desc=True,
        limit=1,
    )
    return rows[0] if rows else None


# ── Code generation ───────────────────────────────────────────────────────────

def _generate_code() -> str:
    """Generate a URL-safe, non-sequential, non-PII 8-char code."""
    return secrets.token_urlsafe(6)  # 6 bytes → 8 base64url chars


async def get_or_create_code(user_id: str) -> str:
    existing = await sb_select(
        "referral_participants",
        filters=[("user_id", "eq", user_id)],
        single=True,
    )
    if existing:
        return existing["referral_code"]
    # Generate unique code
    for _ in range(10):
        code = _generate_code()
        conflict = await sb_select(
            "referral_participants",
            filters=[("referral_code", "eq", code)],
            single=True,
        )
        if not conflict:
            return code
    raise RuntimeError("Could not generate a unique referral code")


# ── Balance calculation ───────────────────────────────────────────────────────

async def get_balances(user_id: str) -> dict:
    entries = await sb_select(
        "referral_reward_entries",
        filters=[("participant_user_id", "eq", user_id)],
    )
    now = datetime.now(timezone.utc)

    pending_minor = 0
    approved_minor = 0
    lifetime_earned_minor = 0

    for e in entries:
        amt = e["amount_minor"]
        status = e["status"]
        available_at_raw = e.get("available_at")

        if status == "pending":
            if available_at_raw:
                avail = datetime.fromisoformat(
                    available_at_raw.replace("Z", "+00:00")
                )
                if avail <= now:
                    # hold expired — treat as approved until the job runs
                    approved_minor += amt
                    if amt > 0:
                        lifetime_earned_minor += amt
                else:
                    pending_minor += amt
            else:
                pending_minor += amt
        elif status == "approved":
            approved_minor += amt
            if amt > 0:
                lifetime_earned_minor += amt

    # Reserved = sum of active payout request amounts
    active_payouts = await sb_select(
        "payout_requests",
        filters=[("participant_user_id", "eq", user_id)],
    )
    reserved_minor = sum(
        p["amount_minor"]
        for p in active_payouts
        if p["status"] in ("requested", "under_review", "approved", "processing")
    )
    paid_minor = sum(
        p["amount_minor"] for p in active_payouts if p["status"] == "paid"
    )
    payable_minor = max(0, approved_minor - reserved_minor)

    return {
        "pending_minor": pending_minor,
        "approved_minor": approved_minor,
        "reserved_minor": reserved_minor,
        "payable_minor": payable_minor,
        "paid_minor": paid_minor,
        "lifetime_earned_minor": lifetime_earned_minor,
    }


def _fmt_minor(pence: int) -> str:
    return f"£{pence / 100:.2f}"


# ── Commission calculation ────────────────────────────────────────────────────

def calculate_commission(eligible_base_minor: int, rate_bps: int) -> int:
    """round_half_up(eligible_base * rate_bps / 10000) — integer pence."""
    raw = eligible_base_minor * rate_bps / 10000
    return math.floor(raw + 0.5)


# ── Reward creation ───────────────────────────────────────────────────────────

async def create_pending_reward(
    *,
    referrer_user_id: str,
    attribution_id: str,
    amount_minor: int,
    idempotency_key: str,
    config_version_id: str | None,
    calc_snapshot: dict,
    stripe_invoice_id: str | None = None,
    stripe_subscription_id: str | None = None,
    stripe_payment_intent_id: str | None = None,
    hold_days: int = 30,
) -> dict | None:
    """Insert a pending reward entry. Returns None if idempotency_key already exists."""
    existing = await sb_select(
        "referral_reward_entries",
        filters=[("idempotency_key", "eq", idempotency_key)],
        single=True,
    )
    if existing:
        logger.info("reward already exists for key=%s", idempotency_key)
        return None

    available_at = (
        datetime.now(timezone.utc) + timedelta(days=hold_days)
    ).isoformat()

    row = {
        "participant_user_id": referrer_user_id,
        "attribution_id": attribution_id,
        "type": "reward",
        "amount_minor": amount_minor,
        "currency": "GBP",
        "status": "pending",
        "idempotency_key": idempotency_key,
        "calc_snapshot": calc_snapshot,
        "config_version_id": config_version_id,
        "available_at": available_at,
        "stripe_invoice_id": stripe_invoice_id,
        "stripe_subscription_id": stripe_subscription_id,
        "stripe_payment_intent_id": stripe_payment_intent_id,
    }
    inserted = await sb_insert("referral_reward_entries", row)
    return inserted[0] if isinstance(inserted, list) else inserted


async def create_reversal(
    *,
    referrer_user_id: str,
    attribution_id: str,
    amount_minor: int,           # negative value (the reversal amount)
    idempotency_key: str,
    source_entry_id: str,
    reason: str = "refund",
) -> dict | None:
    existing = await sb_select(
        "referral_reward_entries",
        filters=[("idempotency_key", "eq", idempotency_key)],
        single=True,
    )
    if existing:
        return None
    row = {
        "participant_user_id": referrer_user_id,
        "attribution_id": attribution_id,
        "type": "reversal",
        "amount_minor": amount_minor,
        "currency": "GBP",
        "status": "approved",          # reversals are immediately effective
        "idempotency_key": idempotency_key,
        "source_entry_id": source_entry_id,
        "calc_snapshot": {"reason": reason},
        "available_at": datetime.now(timezone.utc).isoformat(),
        "approved_at": datetime.now(timezone.utc).isoformat(),
    }
    inserted = await sb_insert("referral_reward_entries", row)
    return inserted[0] if isinstance(inserted, list) else inserted


# ── Scheduled reward approval ─────────────────────────────────────────────────

async def approve_due_rewards(user_id: str | None = None) -> int:
    """Approve all pending rewards whose hold period has passed. Returns count."""
    now_iso = datetime.now(timezone.utc).isoformat()
    filters: list = [("status", "eq", "pending")]
    if user_id:
        filters.append(("participant_user_id", "eq", user_id))

    pending = await sb_select("referral_reward_entries", filters=filters)
    approved_count = 0
    for entry in pending:
        avail = entry.get("available_at")
        if not avail:
            continue
        avail_dt = datetime.fromisoformat(avail.replace("Z", "+00:00"))
        if avail_dt <= datetime.now(timezone.utc):
            await sb_update(
                "referral_reward_entries",
                filters=[("id", "eq", entry["id"])],
                payload={"status": "approved", "approved_at": now_iso},
            )
            approved_count += 1
    return approved_count


# ── Attribution helpers ───────────────────────────────────────────────────────

async def get_attribution_for_referred(user_id: str) -> dict | None:
    return await sb_select(
        "referral_attributions",
        filters=[("referred_user_id", "eq", user_id)],
        single=True,
    )


async def get_participant_by_code(code: str) -> dict | None:
    return await sb_select(
        "referral_participants",
        filters=[("referral_code", "eq", code), ("status", "eq", "active")],
        single=True,
    )


async def create_attribution(
    *,
    referred_user_id: str,
    referrer_user_id: str,
    click_id: str | None,
    method: str = "click",
) -> dict:
    row = {
        "referred_user_id": referred_user_id,
        "referrer_user_id": referrer_user_id,
        "click_id": click_id,
        "method": method,
    }
    inserted = await sb_insert("referral_attributions", row)
    return inserted[0] if isinstance(inserted, list) else inserted


# ── Audit log ────────────────────────────────────────────────────────────────

async def write_audit_log(
    *,
    actor_user_id: str,
    actor_role: str,
    action: str,
    entity_type: str,
    entity_id: str,
    before_state: dict | None = None,
    after_state: dict | None = None,
    reason: str | None = None,
) -> None:
    await sb_insert(
        "referral_audit_logs",
        {
            "actor_user_id": actor_user_id,
            "actor_role": actor_role,
            "action": action,
            "entity_type": entity_type,
            "entity_id": entity_id,
            "before_state": before_state,
            "after_state": after_state,
            "reason": reason,
        },
    )


# ── Fraud flag ────────────────────────────────────────────────────────────────

async def flag_fraud(
    *,
    entity_type: str,
    entity_id: str,
    rule: str,
    severity: str = "medium",
    evidence: dict | None = None,
) -> None:
    await sb_insert(
        "referral_fraud_flags",
        {
            "entity_type": entity_type,
            "entity_id": entity_id,
            "rule": rule,
            "severity": severity,
            "evidence": evidence or {},
        },
    )
