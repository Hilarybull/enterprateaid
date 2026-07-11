from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from app.shared.auth.deps import get_current_user
from app.modules.credits import service as credit_svc

router = APIRouter(prefix="/credits", tags=["credits"])

ADMIN_EMAIL = "tech.support@enterprateai.com"


@router.get("/balance")
async def get_balance(current_user: dict = Depends(get_current_user)):
    user_id = current_user["id"]
    wallet = await credit_svc.get_wallet(user_id)
    if not wallet:
        wallet = await credit_svc.ensure_wallet(user_id)
    if not wallet:
        return {"available_credits": 0, "held_credits": 0, "lifetime_credits_issued": 0, "lifetime_credits_used": 0, "next_reset_at": None}
    return {
        "available_credits": wallet["available_credits"],
        "held_credits": wallet["held_credits"],
        "lifetime_credits_issued": wallet["lifetime_credits_issued"],
        "lifetime_credits_used": wallet["lifetime_credits_used"],
        "next_reset_at": wallet.get("next_reset_at"),
    }


@router.get("/features")
async def get_features(current_user: dict = Depends(get_current_user)):
    features = await credit_svc.get_all_features()
    return {"features": features}


@router.post("/check")
async def check_credits(body: dict, current_user: dict = Depends(get_current_user)):
    feature_code = body.get("feature_code")
    if not feature_code:
        raise HTTPException(status_code=400, detail="feature_code required")
    result = await credit_svc.check_credits(current_user["id"], feature_code)
    return result


@router.get("/transactions")
async def get_transactions(limit: int = 50, current_user: dict = Depends(get_current_user)):
    txns = await credit_svc.get_transactions(current_user["id"], limit=min(limit, 200))
    return {"transactions": txns}


@router.post("/admin/grant")
async def admin_grant_credits(body: dict, current_user: dict = Depends(get_current_user)):
    if current_user.get("email") != ADMIN_EMAIL:
        raise HTTPException(status_code=403, detail="Forbidden")
    user_id = body.get("user_id")
    amount = body.get("amount")
    reason = body.get("reason", "Admin grant")
    grant_type = body.get("grant_type", "admin_adjustment")
    if not user_id or amount is None:
        raise HTTPException(status_code=400, detail="user_id and amount required")
    result = await credit_svc.grant_credits(user_id, int(amount), grant_type, reason)
    return result


@router.post("/admin/deduct")
async def admin_deduct_credits(body: dict, current_user: dict = Depends(get_current_user)):
    if current_user.get("email") != ADMIN_EMAIL:
        raise HTTPException(status_code=403, detail="Forbidden")
    user_id = body.get("user_id")
    amount = body.get("amount")
    reason = body.get("reason", "Admin deduction")
    if not user_id or amount is None:
        raise HTTPException(status_code=400, detail="user_id and amount required")
    result = await credit_svc.deduct_credits_admin(user_id, int(amount), reason)
    return result


@router.get("/admin/wallet/{user_id}")
async def admin_get_wallet(user_id: str, current_user: dict = Depends(get_current_user)):
    if current_user.get("email") != ADMIN_EMAIL:
        raise HTTPException(status_code=403, detail="Forbidden")
    wallet = await credit_svc.get_wallet(user_id)
    if not wallet:
        raise HTTPException(status_code=404, detail="Wallet not found")
    return wallet
