from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Response, status
from app.core.config import get_settings
from app.core.supabase import sb_insert, sb_select, sb_update
from app.shared.auth.google import verify_google_id_token
from app.shared.auth.schemas import ChangePasswordRequest, ForgotPasswordRequest, GoogleAuthRequest, LoginRequest, RegisterRequest, ResetPasswordRequest, TokenResponse, UpdateProfileRequest, UserPublic
from app.shared.auth.security import create_access_token, hash_password, verify_password
from app.shared.auth.deps import get_current_user
from app.shared.email.sendgrid import send_password_reset_email

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=UserPublic)
async def register(payload: RegisterRequest) -> UserPublic:
    existing = await sb_select("users", filters=[("email", "eq", payload.email.lower())], single=True)
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")
    user_doc = {"id": payload.email.lower(), "email": payload.email.lower(), "password_hash": hash_password(payload.password)}
    await sb_insert("users", user_doc)
    return UserPublic(id=user_doc["id"], email=user_doc["email"])


@router.post("/login", response_model=TokenResponse)
async def login(payload: LoginRequest) -> TokenResponse:
    user = await sb_select("users", filters=[("id", "eq", payload.email.lower())], single=True)
    if not user or not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    if user.get("is_blocked"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account suspended. Contact support at tech.support@enterprateai.com")
    token = create_access_token(subject=user["id"])
    return TokenResponse(access_token=token)


@router.post("/google", response_model=TokenResponse)
async def google_auth(payload: GoogleAuthRequest) -> TokenResponse:
    settings = get_settings()
    if not settings.google_client_id:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Google auth not configured")

    identity = verify_google_id_token(credential=payload.credential, audience=settings.google_client_id)

    # Upsert user by email to keep user_id stable across auth methods.
    existing = await sb_select("users", filters=[("id", "eq", identity.email)], single=True)
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

    reset_url = f"{settings.frontend_url}/reset-password?token={token}"
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
