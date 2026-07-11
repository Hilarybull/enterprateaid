from __future__ import annotations

import json
import logging
from datetime import datetime, timezone, timedelta

import stripe
from fastapi import APIRouter, Depends, HTTPException, Request, status
from app.core.config import get_settings
from app.core.supabase import sb_insert, sb_select, sb_upsert
from app.modules.plans.schemas import (
    CheckoutRequest, CheckoutResponse,
    SubscribeRequest, SubscribeResponse,
    SubscriptionOut,
)
from app.shared.auth.deps import get_current_user

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
        try:
            stripe_sub = client.subscriptions.retrieve(subscription_id)
            meta = getattr(stripe_sub, "metadata", {}) or {}
            plan_key = meta.get("plan_key")
            billing_period = meta.get("billing_period", "monthly")
            customer_id = getattr(stripe_sub, "customer", None)
        except Exception as e:
            logger.error("activate_subscription: retrieve sub failed: %s", e)
            raise HTTPException(status_code=400, detail="Could not verify subscription with Stripe.")

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
    return {"activated": True, "plan_key": plan_key, "billing_period": billing_period, "period_end": period_end}


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
            # Grant plan credits for the new subscription
            try:
                from app.modules.credits.service import provision_plan_credits
                await provision_plan_credits(user_id, plan_key, f"Stripe checkout — {plan_key} plan")
            except Exception as exc:
                logger.warning("Credit provisioning failed for %s plan %s: %s", user_id, plan_key, exc)

    elif etype in ("customer.subscription.deleted", "customer.subscription.updated"):
        sub_obj = event["data"]["object"] if isinstance(event, dict) else event.data.object
        sub_id = sub_obj.get("id") if isinstance(sub_obj, dict) else sub_obj.id
        new_status = sub_obj.get("status") if isinstance(sub_obj, dict) else sub_obj.status
        cancel_at = sub_obj.get("canceled_at") if isinstance(sub_obj, dict) else getattr(sub_obj, "canceled_at", None)
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

    elif etype == "invoice.payment_succeeded":
        await _handle_invoice_payment(event)

    elif etype in ("charge.refunded", "invoice.payment_failed"):
        await _handle_refund_or_failure(event, etype)

    return {"received": True}


async def _handle_invoice_payment(event) -> None:
    """Create a pending referral reward when an eligible invoice is paid."""
    try:
        from app.modules.referral import service as ref_svc

        inv = event["data"]["object"] if isinstance(event, dict) else event.data.object
        invoice_id = inv.get("id") if isinstance(inv, dict) else inv.id
        customer_id = inv.get("customer") if isinstance(inv, dict) else getattr(inv, "customer", None)
        sub_id = inv.get("subscription") if isinstance(inv, dict) else getattr(inv, "subscription", None)
        amount_paid = inv.get("amount_paid", 0) if isinstance(inv, dict) else getattr(inv, "amount_paid", 0)
        subtotal = inv.get("subtotal", 0) if isinstance(inv, dict) else getattr(inv, "subtotal", 0)
        tax = inv.get("tax", 0) if isinstance(inv, dict) else getattr(inv, "tax", 0)

        if not customer_id or not invoice_id or amount_paid <= 0:
            return

        # Find the user from stripe_customer_id
        sub_row = await sb_select(
            "user_subscriptions",
            filters=[("stripe_customer_id", "eq", customer_id)],
            single=True,
        )
        if not sub_row:
            return
        user_id = sub_row["user_id"]

        # Find referral attribution for this user (were they referred?)
        attribution = await ref_svc.get_attribution_for_referred(user_id)
        if not attribution:
            return

        referrer_id = attribution["referrer_user_id"]

        # Check referrer is an active participant
        participant = await sb_select(
            "referral_participants",
            filters=[("user_id", "eq", referrer_id), ("status", "eq", "active")],
            single=True,
        )
        if not participant:
            return

        # Check if this is first payment only or recurring
        config = await ref_svc.get_active_config()
        if not config.get("recurring", True):
            existing_rewards = await sb_select(
                "referral_reward_entries",
                filters=[("attribution_id", "eq", attribution["id"])],
            )
            if existing_rewards:
                return  # first-payment-only mode: skip renewals

        # eligible_base = max(0, subtotal - tax - refunded)
        eligible_base = max(0, subtotal - (tax or 0))
        if eligible_base <= 0:
            return

        commission = ref_svc.calculate_commission(eligible_base, config["rate_bps"])
        if commission <= 0:
            return

        idem_key = f"invoice_{invoice_id}"
        snapshot = {
            "rate_bps": config["rate_bps"],
            "eligible_base_minor": eligible_base,
            "subtotal_minor": subtotal,
            "tax_minor": tax,
            "commission_minor": commission,
            "invoice_id": invoice_id,
        }
        await ref_svc.create_pending_reward(
            referrer_user_id=referrer_id,
            attribution_id=attribution["id"],
            amount_minor=commission,
            idempotency_key=idem_key,
            config_version_id=config.get("id"),
            calc_snapshot=snapshot,
            stripe_invoice_id=invoice_id,
            stripe_subscription_id=sub_id,
            hold_days=config["hold_days"],
        )
        logger.info(
            "referral reward created referrer=%s referred=%s commission_minor=%s invoice=%s",
            referrer_id, user_id, commission, invoice_id,
        )
    except Exception as exc:
        logger.error("_handle_invoice_payment error: %s", exc)


async def _handle_refund_or_failure(event, etype: str) -> None:
    """Create a linked reversal when an invoice is refunded or charge reversed."""
    try:
        from app.modules.referral import service as ref_svc

        obj = event["data"]["object"] if isinstance(event, dict) else event.data.object

        if etype == "charge.refunded":
            invoice_id = obj.get("invoice") if isinstance(obj, dict) else getattr(obj, "invoice", None)
            refunded_minor = obj.get("amount_refunded", 0) if isinstance(obj, dict) else getattr(obj, "amount_refunded", 0)
        else:
            invoice_id = obj.get("id") if isinstance(obj, dict) else getattr(obj, "id", None)
            refunded_minor = obj.get("amount_due", 0) if isinstance(obj, dict) else getattr(obj, "amount_due", 0)

        if not invoice_id:
            return

        # Find the original reward entry for this invoice
        original = await sb_select(
            "referral_reward_entries",
            filters=[("stripe_invoice_id", "eq", invoice_id), ("type", "eq", "reward")],
            single=True,
        )
        if not original:
            return

        # Calculate proportional reversal
        orig_snapshot = original.get("calc_snapshot") or {}
        orig_base = orig_snapshot.get("eligible_base_minor", 0)
        config = await ref_svc.get_active_config()
        reversal_minor = -ref_svc.calculate_commission(min(refunded_minor, orig_base), config["rate_bps"])

        idem_key = f"reversal_{invoice_id}_{etype}"
        await ref_svc.create_reversal(
            referrer_user_id=original["participant_user_id"],
            attribution_id=original["attribution_id"],
            amount_minor=reversal_minor,
            idempotency_key=idem_key,
            source_entry_id=original["id"],
            reason=etype,
        )
        logger.info("referral reversal created for invoice=%s reversal_minor=%s", invoice_id, reversal_minor)
    except Exception as exc:
        logger.error("_handle_refund_or_failure error: %s", exc)


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
            billing_period=sub.get("billing_period", "monthly"),
            status=sub["status"],
            current_period_start=sub.get("current_period_start"),
            current_period_end=sub.get("current_period_end"),
            trial_started_at=sub.get("trial_started_at"),
            stripe_subscription_id=sub.get("stripe_subscription_id"),
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
