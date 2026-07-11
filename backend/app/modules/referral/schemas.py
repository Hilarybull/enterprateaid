from __future__ import annotations
from pydantic import BaseModel
from typing import Optional


class EnrolRequest(BaseModel):
    terms_version: str = "1.0"


class RecordClickRequest(BaseModel):
    code: str
    landing_path: Optional[str] = None


class RecordClickResponse(BaseModel):
    click_id: str
    expires_at: str
    referral_code: str


class PayoutProfileRequest(BaseModel):
    method: str = "bank_transfer"          # bank_transfer | paypal
    account_name: Optional[str] = None
    account_number: Optional[str] = None   # full digits — masked on save
    sort_code: Optional[str] = None
    paypal_email: Optional[str] = None


class PayoutRequestCreate(BaseModel):
    idempotency_key: Optional[str] = None


# Admin
class AdminPayoutDecision(BaseModel):
    action: str        # approve | reject | action_required | mark_paid
    reason: str
    provider_reference: Optional[str] = None


class AdminAdjustmentRequest(BaseModel):
    participant_user_id: str
    amount_minor: int   # pence; negative to reverse
    reason: str
    category: str       # correction | goodwill | fraud_reversal
