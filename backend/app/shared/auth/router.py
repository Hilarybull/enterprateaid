from __future__ import annotations

import logging
import secrets
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Response, status
from app.core.config import get_settings
from app.core.supabase import sb_insert, sb_select, sb_update
from app.shared.auth.google import verify_google_id_token
from app.shared.auth.schemas import ChangePasswordRequest, ForgotPasswordRequest, GoogleAuthRequest, LoginRequest, RegisterRequest, ResetPasswordRequest, TokenResponse, UpdateProfileRequest, UserPublic
from app.shared.auth.security import create_access_token, hash_password, verify_password
from app.shared.auth.deps import get_current_user
from app.shared.email.resend import send_password_reset_email, send_password_otp_email, send_email_verification_email

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])
DEMO_USER_ID = "demo@enterprate.ai"
DEMO_USER_EMAIL = "demo@enterprate.ai"
DEMO_USER_PASSWORD = "enterprateai-demo-access"


async def _resolve_referral_attribution(new_user_id: str, ref_click_id: str | None, ref_code: str | None) -> None:
    """Attempt to link a new user to a referrer. Silent on failure — never blocks registration."""
    try:
        from app.modules.referral import service as ref_svc
        from app.modules.referral.service import create_attribution

        # Resolve referrer via click_id or code
        referrer_user_id: str | None = None
        click_id: str | None = None
        method = "click"

        if ref_click_id:
            click = await sb_select("referral_clicks", filters=[("id", "eq", ref_click_id)], single=True)
            if click:
                expiry_raw = click.get("expires_at")
                if expiry_raw:
                    expiry = datetime.fromisoformat(expiry_raw.replace("Z", "+00:00"))
                    if expiry > datetime.now(timezone.utc):
                        referrer_user_id = click.get("participant_user_id")
                        click_id = click["id"]
                        # Mark click as converted
                        await sb_update("referral_clicks", filters=[("id", "eq", click_id)], payload={"converted": True})

        if not referrer_user_id and ref_code:
            participant = await ref_svc.get_participant_by_code(ref_code)
            if participant:
                referrer_user_id = participant["user_id"]
                method = "manual_code"

        if not referrer_user_id:
            return

        # Self-referral check
        if referrer_user_id == new_user_id:
            await ref_svc.flag_fraud(
                entity_type="user",
                entity_id=new_user_id,
                rule="self_referral",
                severity="high",
                evidence={"ref_code": ref_code, "ref_click_id": ref_click_id},
            )
            return

        # Only new users qualify — check referrer is an active participant
        participant_row = await sb_select(
            "referral_participants",
            filters=[("user_id", "eq", referrer_user_id), ("status", "eq", "active")],
            single=True,
        )
        if not participant_row:
            return

        await create_attribution(
            referred_user_id=new_user_id,
            referrer_user_id=referrer_user_id,
            click_id=click_id,
            method=method,
        )
        logger.info("Referral attribution: %s referred by %s", new_user_id, referrer_user_id)
    except Exception as exc:
        logger.warning("Referral attribution failed for new user %s: %s", new_user_id, exc)


@router.post("/register", response_model=UserPublic)
async def register(payload: RegisterRequest) -> UserPublic:
    settings = get_settings()
    existing = await sb_select("users", filters=[("email", "eq", payload.email.lower())], single=True)
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")
    verification_token = secrets.token_urlsafe(32)
    user_doc = {
        "id": payload.email.lower(),
        "email": payload.email.lower(),
        "password_hash": hash_password(payload.password),
        "email_verified": False,
        "email_verification_token": verification_token,
        "name": payload.full_name,
        "phone": payload.phone,
        "company": payload.company,
    }
    await sb_insert("users", user_doc)
    await _resolve_referral_attribution(user_doc["id"], payload.ref_click_id, payload.ref_code)
    try:
        # frontend_url may alias CORS_ORIGINS which can be a comma-separated list
        frontend_base = str(settings.frontend_url).split(",")[0].strip().rstrip("/")
        verify_url = f"{frontend_base}/verify-email?token={verification_token}"
        await send_email_verification_email(to_email=payload.email, verify_url=verify_url, name=payload.full_name)
    except Exception as e:
        logger.warning("Verification email send failed for %s: %s", payload.email, e)
    return UserPublic(id=user_doc["id"], email=user_doc["email"], email_verification_sent=True)


@router.get("/verify-email")
async def verify_email(token: str) -> dict:
    user = await sb_select("users", filters=[("email_verification_token", "eq", token)], single=True)
    if not user:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired verification link.")
    await sb_update(
        "users",
        filters=[("id", "eq", user["id"])],
        payload={"email_verified": True, "email_verification_token": None},
    )
    return {"verified": True, "email": user["email"]}


@router.post("/login", response_model=TokenResponse)
async def login(payload: LoginRequest) -> TokenResponse:
    user = await sb_select("users", filters=[("id", "eq", payload.email.lower())], single=True)
    if not user or not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    if user.get("email_verified") is False:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Email not verified. Please check your inbox and click the verification link.")
    if user.get("is_blocked"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account suspended. Contact support at tech.support@enterprateai.com")
    token = create_access_token(subject=user["id"])
    return TokenResponse(access_token=token)


@router.post("/demo", response_model=TokenResponse)
async def demo_login() -> TokenResponse:
    settings = get_settings()
    user = await _ensure_demo_user(
        email=(settings.demo_email or DEMO_USER_EMAIL).lower().strip(),
        password=(settings.demo_password or DEMO_USER_PASSWORD),
    )
    token = create_access_token(subject=user["id"])
    # Ensure demo user has a pre-seeded workspace with sample data (non-fatal)
    try:
        await _ensure_demo_workspace(user["id"])
    except Exception as e:
        logger.warning("Demo workspace seed failed (non-fatal): %s", e)
    return TokenResponse(access_token=token)


async def _ensure_demo_user(*, email: str, password: str) -> dict:
    user = await sb_select("users", filters=[("id", "eq", email)], single=True)
    if user and verify_password(password, user.get("password_hash", "")):
        return user

    password_hash = hash_password(password)
    record = {
        "id": email,
        "email": email,
        "password_hash": password_hash,
        "is_blocked": False,
    }
    if user:
        await sb_update("users", filters=[("id", "eq", email)], payload=record)
        updated = await sb_select("users", filters=[("id", "eq", email)], single=True)
        if updated:
            return updated
    else:
        await sb_insert("users", record)
        created = await sb_select("users", filters=[("id", "eq", email)], single=True)
        if created:
            return created

    return record


_DEMO_MODULE_KEYS = [
    "dashboard", "validation", "blueprint", "simulation",
    "catalogue", "financials", "integrations", "registration",
]


async def _ensure_demo_workspace(user_id: str) -> None:
    # Unlock every module for the demo account so it reads as fully-featured —
    # via user_platform_grants (a feature-visibility override), NOT by writing a
    # real user_subscriptions row.
    #
    # This used to insert {"plan_key": "starter_insight", "status": "active"} into
    # user_subscriptions whenever the demo account had no subscription row yet.
    # That table is the same one Stripe checkout writes to and the credit system
    # reads as ground truth for plan/entitlement — so it wasn't a cosmetic unlock,
    # it was a real, unpaid upgrade to a $19/mo paid plan plus its full 500-credit
    # monthly allocation (visible to the credit ledger as a genuine plan change).
    # Every time this ran with no existing row (e.g. the demo account's very first
    # login, or after anything cleared/never-created that row) it silently handed
    # out real spendable AI credits and paid-tier access with no payment. Use the
    # existing admin "full access" grant mechanism instead: it unlocks the same
    # module UI without touching plan_key, credits, or billing state at all.
    try:
        existing_rows = await sb_select(
            "user_platform_grants",
            filters=[("user_id", "eq", user_id)],
            columns="module_key,feature_key",
        )
    except Exception:
        existing_rows = []

    existing_keys = {r["module_key"] for r in (existing_rows or []) if not r.get("feature_key")}
    docs = [
        {"id": str(uuid4()), "user_id": user_id, "module_key": module_key, "feature_key": ""}
        for module_key in _DEMO_MODULE_KEYS
        if module_key not in existing_keys
    ]
    if docs:
        try:
            await sb_insert("user_platform_grants", docs)
        except Exception:
            pass

    demo_data = {
        "workspace_profile": {
            "company_name": "Apex Consulting Ltd",
            "tagline": "Strategic growth for ambitious businesses",
            "about_company": "Apex Consulting is a London-based advisory firm helping ambitious SMEs unlock growth through data-driven strategy, financial planning, and operational excellence. We have supported over 40 businesses across retail, tech, and professional services.",
            "primary_industry": "Business Consulting",
            "business_type": "limited_company",
            "operating_stage": "growth",
            "delivery_model": "hybrid",
            "city": "London",
            "country": "United Kingdom",
            "email": "hello@apexconsulting.co.uk",
            "phone_number": "+44 20 7946 0123",
            "website": "www.apexconsulting.co.uk",
            "target_customer_type": "b2b",
            "primary_revenue_model": "project_based",
            "key_offering_focus": "Strategic advisory and growth planning for UK SMEs",
            "vision": "To be the go-to growth partner for ambitious UK SMEs",
            "mission": "Helping businesses unlock their full potential through practical, data-driven strategy",
            "employee_count": 8,
            "core_values": ["Integrity", "Results-first", "Partnership"],
            "services": [
                {"service_name": "Strategy Sprint", "price": 2500, "unit": "project", "description": "4-week intensive strategy and planning session"},
                {"service_name": "Business Plan", "price": 1500, "unit": "document", "description": "Investor-ready business plan with financial projections"},
                {"service_name": "Market Analysis", "price": 800, "unit": "report", "description": "Competitor and market sizing deep-dive report"},
            ],
        },
        "business_profile": {
            "business_name": "Apex Consulting Ltd",
            "primary_industry": "Business Consulting",
            "location": "London, United Kingdom",
            "currency": "GBP",
            "business_type": "limited_company",
        },
        "catalogue": {
            "products": [
                {"id": "prod-001", "name": "Strategy Sprint", "category": "Service", "price": 2500, "base_price": 2500, "currency": "GBP", "unit": "project", "description": "4-week intensive strategy session", "active": True},
                {"id": "prod-002", "name": "Business Plan", "category": "Service", "price": 1500, "base_price": 1500, "currency": "GBP", "unit": "document", "description": "Investor-ready business plan with financials", "active": True},
                {"id": "prod-003", "name": "Market Analysis Report", "category": "Service", "price": 800, "base_price": 800, "currency": "GBP", "unit": "report", "description": "Deep-dive competitor and market sizing analysis", "active": True},
                {"id": "prod-004", "name": "Growth Advisory Retainer", "category": "Retainer", "price": 1200, "base_price": 1200, "currency": "GBP", "unit": "month", "description": "Ongoing monthly advisory and support", "active": True},
            ],
            "customers": [
                {"id": "cust-001", "name": "Meridian Tech Ltd", "email": "accounts@meridiantech.co.uk", "phone": "+44 7700 900111", "type": "business", "city": "London", "country": "UK", "active": True},
                {"id": "cust-002", "name": "Parkview Retail Group", "email": "finance@parkviewretail.com", "phone": "+44 7700 900222", "type": "business", "city": "Manchester", "country": "UK", "active": True},
                {"id": "cust-003", "name": "BlueSky Ventures", "email": "info@bluesky.vc", "phone": "+44 7700 900333", "type": "business", "city": "Edinburgh", "country": "UK", "active": True},
            ],
            "vendors": [
                {"id": "vend-001", "name": "CloudForce Hosting", "email": "billing@cloudforce.io", "category": "Software", "active": True},
                {"id": "vend-002", "name": "London Office Supplies", "email": "orders@lossupplies.co.uk", "category": "Office", "active": True},
            ],
        },
        "financials": {
            "invoices": [
                {
                    "id": "inv-001", "number": "INV-001",
                    "customer_id": "cust-001", "customer_name": "Meridian Tech Ltd",
                    "date": "2026-06-15", "due_date": "2026-07-15", "status": "paid",
                    "currency": "GBP",
                    "product_ids": ["prod-001"],
                    "product_names": ["Strategy Sprint"],
                    "items": [{"product_id": "prod-001", "name": "Strategy Sprint", "quantity": 1, "unit_price": 2500, "total_amount": 2500}],
                    "subtotal_amount": 2500, "total_amount": 2500,
                },
                {
                    "id": "inv-002", "number": "INV-002",
                    "customer_id": "cust-002", "customer_name": "Parkview Retail Group",
                    "date": "2026-07-01", "due_date": "2026-08-01", "status": "sent",
                    "currency": "GBP",
                    "product_ids": ["prod-002"],
                    "product_names": ["Business Plan"],
                    "items": [{"product_id": "prod-002", "name": "Business Plan", "quantity": 1, "unit_price": 1500, "total_amount": 1500}],
                    "subtotal_amount": 1500, "total_amount": 1500,
                },
                {
                    "id": "inv-003", "number": "INV-003",
                    "customer_id": "cust-003", "customer_name": "BlueSky Ventures",
                    "date": "2026-07-28", "due_date": "2026-08-28", "status": "draft",
                    "currency": "GBP",
                    "product_ids": ["prod-003", "prod-002"],
                    "product_names": ["Market Analysis Report", "Business Plan"],
                    "items": [
                        {"product_id": "prod-003", "name": "Market Analysis Report", "quantity": 1, "unit_price": 800, "total_amount": 800},
                        {"product_id": "prod-002", "name": "Business Plan", "quantity": 1, "unit_price": 1500, "total_amount": 1500},
                    ],
                    "subtotal_amount": 2300, "total_amount": 2300,
                },
            ],
            "expenses": [
                {"id": "exp-001", "description": "CloudForce Hosting", "price": 120, "currency": "GBP", "category": "Software", "date": "2026-07-01", "status": "paid"},
                {"id": "exp-002", "description": "Office Supplies Q3", "price": 85, "currency": "GBP", "category": "Office", "date": "2026-07-15", "status": "paid"},
                {"id": "exp-003", "description": "LinkedIn Premium", "price": 60, "currency": "GBP", "category": "Marketing", "date": "2026-08-01", "status": "pending"},
            ],
        },
    }

    try:
        now = datetime.now(timezone.utc).isoformat()
        existing = await sb_select("workspaces", filters=[("user_id", "eq", user_id)], limit=1, single=True)
        if existing:
            await sb_update("workspaces", filters=[("id", "eq", existing["id"])], payload={"data": demo_data, "updated_at": now})
        else:
            await sb_insert("workspaces", {
                "id": str(uuid4()),
                "user_id": user_id,
                "name": "Apex Consulting Ltd",
                "data": demo_data,
                "created_at": now,
                "updated_at": now,
            })
    except Exception as e:
        logger.warning("Demo workspace upsert failed: %s", e)


@router.post("/google", response_model=TokenResponse)
async def google_auth(payload: GoogleAuthRequest) -> TokenResponse:
    settings = get_settings()
    if not settings.google_client_id:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Google auth not configured")

    identity = verify_google_id_token(credential=payload.credential, audience=settings.google_client_id)

    # Upsert user by email to keep user_id stable across auth methods.
    existing = await sb_select("users", filters=[("id", "eq", identity.email)], single=True)
    is_new_user = not existing
    if not existing:
        await sb_insert(
            "users",
            {
                "id": identity.email,
                "email": identity.email,
                "auth_provider": "google",
                "google_sub": identity.sub,
                "name": identity.name,
                "picture": identity.picture,
            },
        )
    else:
        await sb_update(
            "users",
            filters=[("id", "eq", identity.email)],
            payload={"auth_provider": existing.get("auth_provider") or "google", "google_sub": identity.sub, "name": identity.name, "picture": identity.picture},
        )

    if is_new_user:
        await _resolve_referral_attribution(identity.email, payload.ref_click_id, payload.ref_code)

    token = create_access_token(subject=identity.email)
    return TokenResponse(access_token=token)


def _user_public(user: dict) -> UserPublic:
    return UserPublic(
        id=user["id"],
        email=user["email"],
        name=user.get("name"),
        picture=user.get("picture"),
        auth_provider=user.get("auth_provider"),
        has_password=bool(user.get("password_hash")),
    )


@router.get("/me", response_model=UserPublic)
async def me(user=Depends(get_current_user)) -> UserPublic:
    return _user_public(user)


@router.patch("/me", response_model=UserPublic)
async def update_profile(payload: UpdateProfileRequest, user=Depends(get_current_user)) -> UserPublic:
    updates: dict = {}
    if payload.name is not None:
        updates["name"] = payload.name.strip() or None
    if updates:
        await sb_update("users", filters=[("id", "eq", user["id"])], payload=updates)
        user = {**user, **updates}
    return _user_public(user)


@router.post("/me/password", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
async def change_password(payload: ChangePasswordRequest, user=Depends(get_current_user)) -> Response:
    if user.get("auth_provider") == "google" and not user.get("password_hash"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Password change is not available for Google accounts")
    if not verify_password(payload.current_password, user.get("password_hash") or ""):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Current password is incorrect")
    await sb_update("users", filters=[("id", "eq", user["id"])], payload={"password_hash": hash_password(payload.new_password)})
    return Response(status_code=status.HTTP_204_NO_CONTENT)


_OTP_EXPIRY_MINUTES = 10


@router.post("/me/send-password-otp", status_code=status.HTTP_200_OK)
async def send_password_otp(user=Depends(get_current_user)) -> dict:
    """Send a 6-digit OTP to the user's email to verify identity before changing password."""
    otp = str(secrets.randbelow(900000) + 100000)  # 100000–999999
    expires_at = (datetime.now(timezone.utc) + timedelta(minutes=_OTP_EXPIRY_MINUTES)).isoformat()
    await sb_update(
        "users",
        filters=[("id", "eq", user["id"])],
        payload={"reset_token": otp, "reset_token_expires_at": expires_at},
    )
    await send_password_otp_email(to_email=user["email"], otp_code=otp)
    return {"detail": "Verification code sent to your email."}


@router.post("/me/change-password-otp", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
async def change_password_with_otp(payload: dict, user=Depends(get_current_user)) -> Response:
    """Verify OTP then update password — no current_password required."""
    otp_code = str(payload.get("otp_code", "")).strip()
    new_password = str(payload.get("new_password", "")).strip()
    if not otp_code or not new_password:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="otp_code and new_password are required.")
    if len(new_password) < 8:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Password must be at least 8 characters.")
    stored_otp = user.get("reset_token")
    expires_str = user.get("reset_token_expires_at")
    if not stored_otp or stored_otp != otp_code:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid verification code.")
    if expires_str:
        expires_at = datetime.fromisoformat(expires_str)
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if datetime.now(timezone.utc) > expires_at:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Verification code has expired. Please request a new one.")
    await sb_update(
        "users",
        filters=[("id", "eq", user["id"])],
        payload={"password_hash": hash_password(new_password), "reset_token": None, "reset_token_expires_at": None},
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


_RESET_TOKEN_EXPIRY_MINUTES = 60


@router.post("/forgot-password", status_code=status.HTTP_200_OK)
async def forgot_password(payload: ForgotPasswordRequest) -> dict:
    settings = get_settings()
    user = await sb_select("users", filters=[("id", "eq", payload.email.lower())], single=True)
    # Always return success to avoid email enumeration
    if not user:
        return {"detail": "If that email is registered, a reset link has been sent."}

    token = secrets.token_urlsafe(32)
    expires_at = (datetime.now(timezone.utc) + timedelta(minutes=_RESET_TOKEN_EXPIRY_MINUTES)).isoformat()
    await sb_update(
        "users",
        filters=[("id", "eq", user["id"])],
        payload={"reset_token": token, "reset_token_expires_at": expires_at},
    )

    reset_url = f"{str(settings.frontend_url).split(',')[0].strip().rstrip('/')}/reset-password?token={token}"
    await send_password_reset_email(
        to_email=user["email"],
        reset_url=reset_url,
        expires_in_minutes=_RESET_TOKEN_EXPIRY_MINUTES,
    )
    return {"detail": "If that email is registered, a reset link has been sent."}


@router.post("/reset-password", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
async def reset_password(payload: ResetPasswordRequest) -> Response:
    user = await sb_select("users", filters=[("reset_token", "eq", payload.token)], single=True)
    if not user or not user.get("reset_token_expires_at"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired reset link.")

    expires_at = datetime.fromisoformat(user["reset_token_expires_at"])
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if datetime.now(timezone.utc) > expires_at:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This reset link has expired. Please request a new one.")

    await sb_update(
        "users",
        filters=[("id", "eq", user["id"])],
        payload={
            "password_hash": hash_password(payload.new_password),
            "reset_token": None,
            "reset_token_expires_at": None,
        },
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/restrictions")
async def get_my_restrictions(user=Depends(get_current_user)) -> list:
    """Returns platform-level module/feature restrictions set by an admin for the current user."""
    from app.core.supabase import sb_select as _sb_select
    try:
        return await _sb_select(
            "user_platform_restrictions",
            filters=[("user_id", "eq", user["id"])],
            columns="module_key,feature_key",
        )
    except Exception:
        return []


@router.get("/grants")
async def get_my_grants(user=Depends(get_current_user)) -> list:
    """Returns platform-level module/feature grants set by an admin for the current user."""
    from app.core.supabase import sb_select as _sb_select
    try:
        return await _sb_select(
            "user_platform_grants",
            filters=[("user_id", "eq", user["id"])],
            columns="module_key,feature_key",
        )
    except Exception:
        return []
