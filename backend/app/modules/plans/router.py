from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone, timedelta

import stripe
from fastapi import APIRouter, Depends, HTTPException, Request, status
from app.core.config import get_settings
from app.core.supabase import sb_insert, sb_select, sb_update, sb_upsert
from app.modules.plans.schemas import (
    CheckoutRequest, CheckoutResponse,
    SubscribeRequest, SubscribeResponse,
    SubscriptionOut,
)
from app.shared.auth.deps import get_current_user
from app.modules.credits.service import provision_plan_credits, reset_monthly_credits
from app.modules.referral import service as ref_svc

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/plans", tags=["plans"])

TRIAL_DAYS = 14

# Users created before this date are grandfathered — no plan-based access restrictions.
GRANDFATHERED_BEFORE = datetime(2026, 5, 7, 0, 0, 0, tzinfo=timezone.utc)

# Maps (plan_key, billing_period) → settings attribute name
_PRICE_ATTR = {
    # Current active plans
    ("starter_insight", "monthly"): "stripe_price_insight_starter_monthly",
    ("starter_insight", "annual"):  "stripe_price_insight_starter_annual",
    ("decision_engine", "monthly"): "stripe_price_decision_engine_monthly",
    ("decision_engine", "annual"):  "stripe_price_decision_engine_annual",
    ("growth_navigator", "monthly"): "stripe_price_strategic_intelligence_monthly",
    ("growth_navigator", "annual"):  "stripe_price_strategic_intelligence_annual",
    ("strategic_business_os", "monthly"): "stripe_price_strategic_business_os_monthly",
    ("strategic_business_os", "annual"):  "stripe_price_strategic_business_os_annual",
    # Legacy aliases
    ("insight_starter", "monthly"): "stripe_price_insight_starter_monthly",
    ("insight_starter", "annual"):  "stripe_price_insight_starter_annual",
    ("strategic_intelligence", "monthly"): "stripe_price_strategic_intelligence_monthly",
    ("strategic_intelligence", "annual"):  "stripe_price_strategic_intelligence_annual",
}


def _stripe_client():
    settings = get_settings()
    if not settings.stripe_secret_key:
        raise HTTPException(status_code=503, detail="Payment system not configured. Contact support.")
    # stripe.StripeClient is the constructor in SDK v5–v11; v12+ also accepts stripe.Stripe
    cls = getattr(stripe, "StripeClient", None) or getattr(stripe, "Stripe", None)
    if cls is None:
        raise HTTPException(status_code=503, detail="Stripe SDK version not supported.")
    return cls(settings.stripe_secret_key)


def _get_price_id(plan_key: str, billing_period: str) -> str:
    settings = get_settings()
    attr = _PRICE_ATTR.get((plan_key, billing_period))
    if not attr:
        raise HTTPException(status_code=400, detail="Invalid plan or billing period.")
    price_id = getattr(settings, attr, None)
    if not price_id or not str(price_id).startswith("price_"):
        raise HTTPException(
            status_code=503,
            detail=f"Payment not yet configured for this plan. Please use Bank Transfer or contact support.",
        )
    return price_id


def _frontend_url() -> str:
    settings = get_settings()
    url = settings.frontend_url
    if isinstance(url, list):
        url = url[0]
    return str(url).rstrip("/")


# ── Add-on catalogue ─────────────────────────────────────────────────────────

ADDONS = [
    # Featured listing boosts — recurring monthly
    {"key": "addon_featured_1",  "label": "Extra Featured Listing",        "price": 15,  "currency": "gbp", "mode": "subscription", "desc": "1 featured listing slot added to your plan, billed monthly.",       "price_attr": "stripe_price_addon_featured_1"},
    {"key": "addon_featured_5",  "label": "5 Featured Listing Boosts",     "price": 49,  "currency": "gbp", "mode": "subscription", "desc": "5 featured listing boosts per month, billed monthly.",              "price_attr": "stripe_price_addon_featured_5"},
    {"key": "addon_featured_20", "label": "20 Featured Listing Boosts",    "price": 149, "currency": "gbp", "mode": "subscription", "desc": "20 featured listing boosts per month, billed monthly.",             "price_attr": "stripe_price_addon_featured_20"},
    # RFQ credit packs — one-time
    {"key": "addon_rfq_20",      "label": "RFQ Credits — 20",              "price": 10,  "currency": "gbp", "mode": "payment",      "desc": "20 RFQ response credits. Use to respond to buyer requests.",      "price_attr": "stripe_price_addon_rfq_20"},
    {"key": "addon_rfq_50",      "label": "RFQ Credits — 50",              "price": 20,  "currency": "gbp", "mode": "payment",      "desc": "50 RFQ response credits. Best value for active suppliers.",       "price_attr": "stripe_price_addon_rfq_50"},
    {"key": "addon_rfq_100",     "label": "RFQ Credits — 100",             "price": 35,  "currency": "gbp", "mode": "payment",      "desc": "100 RFQ response credits. Maximum pack for high-volume sellers.", "price_attr": "stripe_price_addon_rfq_100"},
]

_ADDON_BY_KEY = {a["key"]: a for a in ADDONS}


@router.get("/addons")
async def list_addons():
    """Return available marketplace add-ons."""
    return ADDONS


@router.post("/addons/checkout")
async def addon_checkout(
    payload: dict,
    user=Depends(get_current_user),
):
    """Create a Stripe Checkout session for a marketplace add-on."""
    addon_key = payload.get("addon_key")
    addon = _ADDON_BY_KEY.get(addon_key)
    if not addon:
        raise HTTPException(status_code=400, detail="Unknown add-on.")

    client = _stripe_client()
    settings = get_settings()
    price_id = getattr(settings, addon["price_attr"], None)
    if not price_id or not price_id.startswith("price_"):
        raise HTTPException(status_code=503, detail=f"Add-on '{addon['label']}' is not yet available for purchase.")

    base = _frontend_url()
    session = client.checkout.sessions.create({
        "mode": addon["mode"],
        "line_items": [{"price": price_id, "quantity": 1}],
        "customer_email": user["email"],
        "metadata": {
            "user_id": user["id"],
            "addon_key": addon_key,
        },
        "success_url": f"{base}/pricing/success?addon={addon_key}",
        "cancel_url": f"{base}/pricing",
    })
    return {"checkout_url": session.url}


# ── Public: subscribe interest capture ───────────────────────────────────────

@router.post("/waitlist", response_model=SubscribeResponse)
async def subscribe_interest(payload: SubscribeRequest) -> SubscribeResponse:
    """Capture subscription interest (used when Stripe is not yet configured)."""
    existing = await sb_select(
        "plan_waitlist",
        filters=[("email", "eq", payload.email), ("plan_key", "eq", payload.plan_key)],
        single=True,
    )
    if not existing:
        await sb_insert(
            "plan_waitlist",
            {
                "email": payload.email,
                "plan_key": payload.plan_key,
                "billing_period": payload.billing_period,
                "joined_at": datetime.now(timezone.utc).isoformat(),
            },
        )
    return SubscribeResponse()


# ── Authenticated: embedded card payment (Stripe Elements) ───────────────────

@router.post("/create-subscription")
async def create_subscription(
    payload: CheckoutRequest,
    user=Depends(get_current_user),
):
    """Create a Stripe Subscription and return a PaymentIntent client_secret
    for confirmation via Stripe Elements on the frontend."""
    client = _stripe_client()
    price_id = _get_price_id(payload.plan_key, payload.billing_period)

    # Reuse existing Stripe customer if we have one
    existing = await sb_select(
        "user_subscriptions",
        filters=[("user_id", "eq", user["id"])],
        single=True,
    )
    customer_id: str | None = (existing or {}).get("stripe_customer_id")

    if not customer_id:
        customer = client.customers.create({
            "email": user["email"],
            "metadata": {"user_id": str(user["id"])},
        })
        customer_id = customer.id

    sub_params: dict = {
        "customer": customer_id,
        "items": [{"price": price_id}],
        "payment_behavior": "default_incomplete",
        "expand": ["latest_invoice.payment_intent"],
        "metadata": {
            "user_id": str(user["id"]),
            "plan_key": payload.plan_key,
            "billing_period": payload.billing_period,
        },
    }
    if payload.promo_code:
        try:
            codes = client.promotion_codes.list({"code": payload.promo_code, "active": True, "limit": 1})
            if not codes.data:
                raise HTTPException(status_code=400, detail="Invalid or expired promo code.")
            sub_params["promotion_code"] = codes.data[0].id
        except HTTPException:
            raise
        except Exception as e:
            logger.error("Promo code lookup failed: %s", e)
            raise HTTPException(status_code=400, detail="Could not validate promo code. Please try again.")

    subscription = client.subscriptions.create(sub_params)

    pi = subscription.latest_invoice.payment_intent  # type: ignore[union-attr]
    invoice = subscription.latest_invoice  # type: ignore[union-attr]
    discount_pct: int | None = None
    discount_amt: int | None = None
    try:
        disc = getattr(invoice, "discount", None) or getattr(subscription, "discount", None)
        if disc:
            coupon = getattr(disc, "coupon", None)
            if coupon:
                discount_pct = getattr(coupon, "percent_off", None)
                discount_amt = getattr(coupon, "amount_off", None)
    except Exception:
        pass
    return {
        "client_secret": pi.client_secret,
        "subscription_id": subscription.id,
        "discount_pct": discount_pct,
        "discount_amt": discount_amt,
    }


# ── Authenticated: eagerly activate subscription after payment ───────────────

@router.post("/activate-subscription")
async def activate_subscription(
    payload: dict,
    user=Depends(get_current_user),
):
    """Called by the frontend right after confirmCardPayment or on the Stripe
    Checkout success page.  Reads the subscription/session from Stripe and
    immediately writes the active row to Supabase so the user doesn't have to
    wait for the webhook."""
    client = _stripe_client()
    subscription_id: str | None = payload.get("subscription_id")
    session_id: str | None = payload.get("session_id")

    stripe_sub = None
    plan_key: str | None = None
    billing_period: str = "monthly"
    customer_id: str | None = None

    if subscription_id:
        # Right after stripe.confirmCardPayment() resolves on the client, the
        # subscription object Stripe returns via the API can briefly still read
        # "incomplete" — Stripe's own transition to "active" lags the payment
        # confirmation by a beat. Retrying a few times before giving up avoids
        # treating a real, successful payment as a failed activation (which
        # previously meant no credits and no plan change even though Stripe had
        # already charged the card).
        last_status: str | None = None
        for attempt in range(4):
            try:
                stripe_sub = client.subscriptions.retrieve(subscription_id)
            except Exception as e:
                logger.error("activate_subscription: retrieve sub failed: %s", e)
                raise HTTPException(status_code=400, detail="Could not verify subscription with Stripe.")
            last_status = getattr(stripe_sub, "status", None)
            if last_status in ("active", "trialing"):
                break
            if attempt < 3:
                await asyncio.sleep(0.75 * (attempt + 1))
        meta = getattr(stripe_sub, "metadata", {}) or {}
        plan_key = meta.get("plan_key")
        billing_period = meta.get("billing_period", "monthly")
        customer_id = getattr(stripe_sub, "customer", None)

    elif session_id:
        try:
            session = client.checkout.sessions.retrieve(session_id)
            meta = getattr(session, "metadata", {}) or {}
            plan_key = meta.get("plan_key")
            billing_period = meta.get("billing_period", "monthly")
            customer_id = getattr(session, "customer", None)
            sub_id = getattr(session, "subscription", None)
            if sub_id:
                stripe_sub = client.subscriptions.retrieve(sub_id)
                subscription_id = sub_id
        except Exception as e:
            logger.error("activate_subscription: retrieve session failed: %s", e)
            raise HTTPException(status_code=400, detail="Could not verify checkout session with Stripe.")
    else:
        raise HTTPException(status_code=400, detail="subscription_id or session_id required.")

    if not stripe_sub:
        raise HTTPException(status_code=400, detail="Subscription not found.")

    sub_status = getattr(stripe_sub, "status", None)
    if sub_status not in ("active", "trialing"):
        raise HTTPException(status_code=402, detail=f"Subscription not yet active (status: {sub_status}).")

    if not plan_key:
        raise HTTPException(status_code=400, detail="Plan key missing from subscription metadata.")

    now = datetime.now(timezone.utc)
    ps = getattr(stripe_sub, "current_period_start", None)
    pe = getattr(stripe_sub, "current_period_end", None)
    period_start = datetime.fromtimestamp(ps, tz=timezone.utc).isoformat() if ps else now.isoformat()
    period_end = datetime.fromtimestamp(pe, tz=timezone.utc).isoformat() if pe else (now + timedelta(days=30 if billing_period == "monthly" else 365)).isoformat()

    # Credit provisioning previously lived ONLY in the Stripe webhook handler
    # below (checkout.session.completed / invoice.paid) — this eager path wrote
    # the new plan_key to user_subscriptions but never granted the plan's
    # credits. That's fine as long as a webhook is registered in the Stripe
    # dashboard and STRIPE_WEBHOOK_SECRET is set; if either isn't (as found
    # while investigating this), the webhook never fires and a paying user's
    # credit balance never moves even though the payment succeeded and the
    # plan badge updates. Decide here — before overwriting the row — whether
    # this is a genuinely new activation for this Stripe subscription, so a
    # retried/duplicate call (or a webhook firing later for the same
    # subscription) can't grant credits twice.
    existing = await sb_select("user_subscriptions", filters=[("user_id", "eq", user["id"])], single=True)
    already_activated = bool(
        existing
        and existing.get("status") == "active"
        and subscription_id
        and existing.get("stripe_subscription_id") == subscription_id
    )

    await sb_upsert(
        "user_subscriptions",
        payload={
            "user_id": user["id"],
            "plan_key": plan_key,
            "billing_period": billing_period,
            "status": "active",
            "stripe_subscription_id": subscription_id,
            "stripe_customer_id": customer_id,
            "current_period_start": period_start,
            "current_period_end": period_end,
            "updated_at": now.isoformat(),
        },
        on_conflict="user_id",
    )

    credits_granted = False
    if not already_activated:
        try:
            await provision_plan_credits(user["id"], plan_key, reason=f"{plan_key} subscription credit allocation")
            credits_granted = True
            logger.info("Provisioned credits for user %s plan %s on activate-subscription", user["id"], plan_key)
        except Exception as e:
            logger.error("Failed to provision credits on activate-subscription for user %s: %s", user["id"], e)

    return {
        "activated": True,
        "plan_key": plan_key,
        "billing_period": billing_period,
        "period_end": period_end,
        "credits_granted": credits_granted,
    }


# ── Authenticated: Stripe checkout ───────────────────────────────────────────

@router.post("/checkout", response_model=CheckoutResponse)
async def create_checkout_session(
    payload: CheckoutRequest,
    user=Depends(get_current_user),
) -> CheckoutResponse:
    client = _stripe_client()
    price_id = _get_price_id(payload.plan_key, payload.billing_period)
    base = _frontend_url()

    session_params: dict = {
        "mode": "subscription",
        "line_items": [{"price": price_id, "quantity": 1}],
        "customer_email": user["email"],
        "metadata": {
            "user_id": user["id"],
            "plan_key": payload.plan_key,
            "billing_period": payload.billing_period,
        },
        "success_url": f"{base}/pricing/success?session_id={{CHECKOUT_SESSION_ID}}",
        "cancel_url": f"{base}/pricing",
        "allow_promotion_codes": True,
    }
    if payload.promo_code:
        try:
            codes = client.promotion_codes.list({"code": payload.promo_code, "active": True, "limit": 1})
            if not codes.data:
                raise HTTPException(status_code=400, detail="Invalid or expired promo code.")
            session_params["discounts"] = [{"promotion_code": codes.data[0].id}]
            session_params.pop("allow_promotion_codes", None)
        except HTTPException:
            raise
        except Exception as e:
            logger.error("Promo code lookup failed: %s", e)
            raise HTTPException(status_code=400, detail="Could not validate promo code. Please try again.")

    session = client.checkout.sessions.create(session_params)
    return CheckoutResponse(checkout_url=session.url)


# ── Referral reward helper ────────────────────────────────────────────────────

async def _create_referral_reward(
    *,
    referred_user_id: str,
    subtotal_minor: int,
    discount_minor: int,
    idempotency_key: str,
    stripe_invoice_id: str | None,
    stripe_subscription_id: str | None,
) -> None:
    """Look up referral attribution for the referred user and create a pending reward if eligible."""
    attribution = await ref_svc.get_attribution_for_referred(referred_user_id)
    if not attribution:
        return

    referrer_id = attribution["referrer_user_id"]
    # Verify referrer is still an active participant
    participant_row = await sb_select(
        "referral_participants",
        filters=[("user_id", "eq", referrer_id), ("status", "eq", "active")],
        single=True,
    )
    if not participant_row:
        return

    config = await ref_svc.get_active_config()
    if not config.get("recurring") and stripe_invoice_id and not idempotency_key.startswith("checkout_"):
        # Recurring disabled — only credit first payment (checkout events)
        return

    eligible_base = max(0, subtotal_minor - discount_minor)
    if eligible_base <= 0:
        return

    effective_rate = (
        participant_row.get("custom_rate_bps")
        if participant_row.get("custom_rate_bps") is not None
        else config["rate_bps"]
    )
    commission = ref_svc.calculate_commission(eligible_base, effective_rate)
    if commission <= 0:
        return

    await ref_svc.create_pending_reward(
        referrer_user_id=referrer_id,
        attribution_id=attribution["id"],
        amount_minor=commission,
        idempotency_key=idempotency_key,
        config_version_id=config.get("id"),
        calc_snapshot={
            "eligible_base_minor": eligible_base,
            "subtotal_minor": subtotal_minor,
            "discount_minor": discount_minor,
            "rate_bps": effective_rate,
            "custom_rate": participant_row.get("custom_rate_bps") is not None,
            "commission_minor": commission,
            "referred_user_id": referred_user_id,
        },
        stripe_invoice_id=stripe_invoice_id,
        stripe_subscription_id=stripe_subscription_id,
        hold_days=config["hold_days"],
    )
    logger.info(
        "Referral reward %d pence created for referrer %s (referred: %s, key: %s)",
        commission, referrer_id, referred_user_id, idempotency_key,
    )


# ── Stripe webhook ────────────────────────────────────────────────────────────

@router.post("/webhook", include_in_schema=False)
async def stripe_webhook(request: Request):
    settings = get_settings()
    payload_bytes = await request.body()
    sig_header = request.headers.get("stripe-signature", "")

    if settings.stripe_webhook_secret:
        try:
            event = stripe.Webhook.construct_event(
                payload_bytes, sig_header, settings.stripe_webhook_secret
            )
        except stripe.SignatureVerificationError:
            raise HTTPException(status_code=400, detail="Invalid webhook signature")
    else:
        # Dev mode: accept unsigned events
        event = json.loads(payload_bytes)

    etype = event.get("type") if isinstance(event, dict) else event.type

    if etype == "checkout.session.completed":
        session = event["data"]["object"] if isinstance(event, dict) else event.data.object
        meta = session.get("metadata", {}) if isinstance(session, dict) else session.metadata
        user_id = meta.get("user_id")
        plan_key = meta.get("plan_key")
        billing_period = meta.get("billing_period", "monthly")

        if user_id and plan_key:
            sub_id = session.get("subscription") if isinstance(session, dict) else session.subscription
            customer_id = session.get("customer") if isinstance(session, dict) else session.customer
            now = datetime.now(timezone.utc)
            period_start: str = now.isoformat()
            period_end: str = (now + timedelta(days=30 if billing_period == "monthly" else 365)).isoformat()
            # Prefer Stripe's actual billing period from the subscription object
            if sub_id:
                try:
                    stripe_client = _stripe_client()
                    stripe_sub = stripe_client.subscriptions.retrieve(sub_id)
                    ps = getattr(stripe_sub, "current_period_start", None)
                    pe = getattr(stripe_sub, "current_period_end", None)
                    if ps:
                        period_start = datetime.fromtimestamp(ps, tz=timezone.utc).isoformat()
                    if pe:
                        period_end = datetime.fromtimestamp(pe, tz=timezone.utc).isoformat()
                except Exception:
                    pass

            # Same idempotency guard as /activate-subscription's eager path: if
            # that already ran for this exact Stripe subscription (the common
            # case — the frontend calls it right after payment, this webhook is
            # a slower backup), don't grant the plan's credits a second time.
            existing = await sb_select("user_subscriptions", filters=[("user_id", "eq", user_id)], single=True)
            already_activated = bool(
                existing
                and existing.get("status") == "active"
                and sub_id
                and existing.get("stripe_subscription_id") == sub_id
            )

            await sb_upsert(
                "user_subscriptions",
                payload={
                    "user_id": user_id,
                    "plan_key": plan_key,
                    "billing_period": billing_period,
                    "status": "active",
                    "stripe_subscription_id": sub_id,
                    "stripe_customer_id": customer_id,
                    "current_period_start": period_start,
                    "current_period_end": period_end,
                    "updated_at": now.isoformat(),
                },
                on_conflict="user_id",
            )
            # Issue initial credits for new subscription
            if not already_activated:
                try:
                    await provision_plan_credits(user_id, plan_key, reason=f"{plan_key} initial subscription credit allocation")
                    logger.info("Provisioned credits for user %s plan %s on checkout", user_id, plan_key)
                except Exception as e:
                    logger.error("Failed to provision credits on checkout for user %s: %s", user_id, e)

            # Create referral reward for initial subscription payment
            try:
                amount_subtotal = session.get("amount_subtotal", 0) if isinstance(session, dict) else getattr(session, "amount_subtotal", 0) or 0
                total_details = session.get("total_details", {}) if isinstance(session, dict) else getattr(session, "total_details", {}) or {}
                amount_discount = total_details.get("amount_discount", 0) if isinstance(total_details, dict) else getattr(total_details, "amount_discount", 0) or 0
                stripe_invoice_id = session.get("invoice") if isinstance(session, dict) else getattr(session, "invoice", None)
                stripe_sub_id = session.get("subscription") if isinstance(session, dict) else getattr(session, "subscription", None)
                await _create_referral_reward(
                    referred_user_id=user_id,
                    subtotal_minor=amount_subtotal or 0,
                    discount_minor=amount_discount or 0,
                    idempotency_key=f"checkout_{session.get('id') if isinstance(session, dict) else session.id}",
                    stripe_invoice_id=str(stripe_invoice_id) if stripe_invoice_id else None,
                    stripe_subscription_id=str(stripe_sub_id) if stripe_sub_id else None,
                )
            except Exception as e:
                logger.error("Failed to create referral reward on checkout for user %s: %s", user_id, e)

    elif etype == "invoice.paid":
        # Monthly renewal — reset credits
        invoice = event["data"]["object"] if isinstance(event, dict) else event.data.object
        customer_id = invoice.get("customer") if isinstance(invoice, dict) else getattr(invoice, "customer", None)
        billing_reason = invoice.get("billing_reason") if isinstance(invoice, dict) else getattr(invoice, "billing_reason", None)
        # Only reset on renewal invoices, not the initial subscription invoice (that's handled in checkout.session.completed)
        if billing_reason == "subscription_cycle" and customer_id:
            sub_row = await sb_select("user_subscriptions", filters=[("stripe_customer_id", "eq", customer_id)], single=True)
            if sub_row and sub_row.get("user_id") and sub_row.get("plan_key"):
                user_id = sub_row["user_id"]
                plan_key = sub_row["plan_key"]
                try:
                    await reset_monthly_credits(user_id, plan_key)
                    logger.info("Reset monthly credits for user %s plan %s on invoice.paid", user_id, plan_key)
                except Exception as e:
                    logger.error("Failed to reset monthly credits for user %s: %s", user_id, e)

                # Create referral reward for recurring subscription renewal
                try:
                    invoice_id = invoice.get("id") if isinstance(invoice, dict) else getattr(invoice, "id", None)
                    sub_id_inv = invoice.get("subscription") if isinstance(invoice, dict) else getattr(invoice, "subscription", None)
                    inv_subtotal = invoice.get("subtotal", 0) if isinstance(invoice, dict) else getattr(invoice, "subtotal", 0) or 0
                    inv_tax = invoice.get("tax", 0) if isinstance(invoice, dict) else getattr(invoice, "tax", 0) or 0
                    eligible_base = max(0, (inv_subtotal or 0) - (inv_tax or 0))
                    await _create_referral_reward(
                        referred_user_id=user_id,
                        subtotal_minor=eligible_base,
                        discount_minor=0,
                        idempotency_key=f"invoice_{invoice_id}",
                        stripe_invoice_id=str(invoice_id) if invoice_id else None,
                        stripe_subscription_id=str(sub_id_inv) if sub_id_inv else None,
                    )
                except Exception as e:
                    logger.error("Failed to create referral reward on invoice.paid for user %s: %s", user_id, e)

    elif etype in ("customer.subscription.deleted", "customer.subscription.updated"):
        sub_obj = event["data"]["object"] if isinstance(event, dict) else event.data.object
        sub_id = sub_obj.get("id") if isinstance(sub_obj, dict) else sub_obj.id
        new_status = sub_obj.get("status") if isinstance(sub_obj, dict) else sub_obj.status
        cancel_at = sub_obj.get("canceled_at") if isinstance(sub_obj, dict) else getattr(sub_obj, "canceled_at", None)
        cancel_at_period_end = bool(sub_obj.get("cancel_at_period_end") if isinstance(sub_obj, dict) else getattr(sub_obj, "cancel_at_period_end", False))
        customer_id = sub_obj.get("customer") if isinstance(sub_obj, dict) else getattr(sub_obj, "customer", None)
        meta = sub_obj.get("metadata", {}) if isinstance(sub_obj, dict) else getattr(sub_obj, "metadata", {})

        rows = await sb_select(
            "user_subscriptions",
            filters=[("stripe_subscription_id", "eq", sub_id)],
            single=True,
        )
        from app.core.supabase import sb_update
        if rows:
            updates: dict = {
                "status": "cancelled" if (new_status == "canceled" or cancel_at) else new_status,
                "cancel_at_period_end": cancel_at_period_end,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
            if cancel_at:
                updates["cancelled_at"] = datetime.fromtimestamp(cancel_at, tz=timezone.utc).isoformat()
            # Sync billing period on renewal / update
            ps = sub_obj.get("current_period_start") if isinstance(sub_obj, dict) else getattr(sub_obj, "current_period_start", None)
            pe = sub_obj.get("current_period_end") if isinstance(sub_obj, dict) else getattr(sub_obj, "current_period_end", None)
            if ps:
                updates["current_period_start"] = datetime.fromtimestamp(ps, tz=timezone.utc).isoformat()
            if pe:
                updates["current_period_end"] = datetime.fromtimestamp(pe, tz=timezone.utc).isoformat()
            await sb_update(
                "user_subscriptions",
                payload=updates,
                filters=[("stripe_subscription_id", "eq", sub_id)],
            )
        elif new_status == "active" and meta.get("user_id"):
            # New subscription activated via embedded card form — upsert the row
            billing_period = meta.get("billing_period", "monthly")
            now = datetime.now(timezone.utc)
            # Use Stripe's actual billing period timestamps from the subscription event object
            ps = sub_obj.get("current_period_start") if isinstance(sub_obj, dict) else getattr(sub_obj, "current_period_start", None)
            pe = sub_obj.get("current_period_end") if isinstance(sub_obj, dict) else getattr(sub_obj, "current_period_end", None)
            period_start = datetime.fromtimestamp(ps, tz=timezone.utc).isoformat() if ps else now.isoformat()
            period_end = datetime.fromtimestamp(pe, tz=timezone.utc).isoformat() if pe else (now + timedelta(days=30 if billing_period == "monthly" else 365)).isoformat()
            await sb_upsert(
                "user_subscriptions",
                payload={
                    "user_id": meta["user_id"],
                    "plan_key": meta.get("plan_key"),
                    "billing_period": billing_period,
                    "status": "active",
                    "stripe_subscription_id": sub_id,
                    "stripe_customer_id": customer_id,
                    "current_period_start": period_start,
                    "current_period_end": period_end,
                    "updated_at": now.isoformat(),
                },
                on_conflict="user_id",
            )

    return {"received": True}


# ── Authenticated: get current subscription ───────────────────────────────────

@router.get("/my", response_model=SubscriptionOut)
async def get_my_subscription(user=Depends(get_current_user)) -> SubscriptionOut:
    try:
        sub = await sb_select(
            "user_subscriptions",
            filters=[("user_id", "eq", user["id"])],
            single=True,
        )
    except Exception:
        sub = None

    if sub and sub.get("status") in ("active", "trial"):
        return SubscriptionOut(
            plan_key=sub["plan_key"],
            billing_period=sub.get("billing_period") or "monthly",
            status=sub["status"],
            current_period_start=sub.get("current_period_start"),
            current_period_end=sub.get("current_period_end"),
            trial_started_at=sub.get("trial_started_at"),
            stripe_subscription_id=sub.get("stripe_subscription_id"),
            cancel_at_period_end=bool(sub.get("cancel_at_period_end")),
        )

    # No active paid subscription → check user creation date
    user_row = await sb_select("users", filters=[("id", "eq", user["id"])], single=True)
    created_at_str = (user_row or {}).get("created_at")
    if created_at_str:
        try:
            created_at = datetime.fromisoformat(created_at_str.replace("Z", "+00:00"))

            # Grandfathered: signed up before restrictions were introduced
            if created_at < GRANDFATHERED_BEFORE:
                return SubscriptionOut(
                    plan_key="free_trial",
                    billing_period="monthly",
                    status="grandfathered",
                    trial_started_at=created_at_str,
                )

        except Exception:
            pass

    # No paid plan → permanent free Explorer plan
    return SubscriptionOut(
        plan_key="explorer",
        billing_period="monthly",
        status="active",
    )


# ── Authenticated: self-serve cancel / resume ─────────────────────────────────
# There was previously no way for a paying user to cancel their own
# subscription — "Cancel anytime" was checkout copy with no feature behind it.
# Cancels at the end of the current paid period (not immediately), matching
# that copy: the user keeps what they already paid for and it simply won't
# renew, rather than losing access mid-period.

async def _get_own_active_subscription(user_id: str) -> dict:
    sub = await sb_select("user_subscriptions", filters=[("user_id", "eq", user_id)], single=True)
    if not sub or sub.get("status") not in ("active", "trial"):
        raise HTTPException(status_code=404, detail="No active subscription found.")
    if not sub.get("stripe_subscription_id"):
        raise HTTPException(
            status_code=400,
            detail="This plan isn't billed through Stripe, so there's nothing to cancel here. Contact support.",
        )
    return sub


@router.post("/cancel-subscription", response_model=SubscriptionOut)
async def cancel_subscription(user=Depends(get_current_user)) -> SubscriptionOut:
    sub = await _get_own_active_subscription(user["id"])
    client = _stripe_client()
    try:
        client.subscriptions.update(sub["stripe_subscription_id"], {"cancel_at_period_end": True})
    except Exception as e:
        logger.error("cancel_subscription failed for user %s: %s", user["id"], e)
        raise HTTPException(status_code=502, detail="Could not reach Stripe to cancel your subscription. Please try again.")

    await sb_update(
        "user_subscriptions",
        payload={"cancel_at_period_end": True, "updated_at": datetime.now(timezone.utc).isoformat()},
        filters=[("user_id", "eq", user["id"])],
    )
    return await get_my_subscription(user=user)


@router.post("/resume-subscription", response_model=SubscriptionOut)
async def resume_subscription(user=Depends(get_current_user)) -> SubscriptionOut:
    """Undo a pending cancel-at-period-end, before the period actually ends."""
    sub = await _get_own_active_subscription(user["id"])
    client = _stripe_client()
    try:
        client.subscriptions.update(sub["stripe_subscription_id"], {"cancel_at_period_end": False})
    except Exception as e:
        logger.error("resume_subscription failed for user %s: %s", user["id"], e)
        raise HTTPException(status_code=502, detail="Could not reach Stripe to resume your subscription. Please try again.")

    await sb_update(
        "user_subscriptions",
        payload={"cancel_at_period_end": False, "updated_at": datetime.now(timezone.utc).isoformat()},
        filters=[("user_id", "eq", user["id"])],
    )
    return await get_my_subscription(user=user)
