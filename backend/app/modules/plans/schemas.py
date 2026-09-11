from __future__ import annotations

from typing import Literal, Optional
from pydantic import BaseModel, EmailStr

VALID_PLAN_KEYS = Literal[
    "free_trial",
    "explorer",
    "starter_insight",
    "insight_starter",
    "decision_engine",
    "growth_navigator",
    "strategic_intelligence",
    "strategic_business_os",
]

VALID_BILLING = Literal["monthly", "annual"]


class SubscribeRequest(BaseModel):
    email: EmailStr
    plan_key: VALID_PLAN_KEYS
    billing_period: Optional[VALID_BILLING] = "monthly"


class SubscribeResponse(BaseModel):
    status: str = "ok"
    message: str = "Subscription request received! We'll be in touch shortly."


class CheckoutRequest(BaseModel):
    plan_key: VALID_PLAN_KEYS
    billing_period: Optional[VALID_BILLING] = "monthly"
    promo_code: Optional[str] = None


class CheckoutResponse(BaseModel):
    checkout_url: str


class SubscriptionOut(BaseModel):
    plan_key: str
    billing_period: str = "monthly"
    status: str
    current_period_start: Optional[str] = None
    current_period_end: Optional[str] = None
    trial_started_at: Optional[str] = None
    stripe_subscription_id: Optional[str] = None
    cancel_at_period_end: bool = False
