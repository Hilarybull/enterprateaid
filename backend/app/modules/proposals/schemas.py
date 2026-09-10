from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, EmailStr, Field, field_validator


# ── Preferences ─────────────────────────────────────────────────────────────
class ProposalPreferences(BaseModel):
    enabled: bool = False
    accepted_modes: list[str] = Field(default_factory=lambda: ["general"])
    accepted_categories: Optional[list[str]] = None
    proposal_cap: Optional[int] = Field(default=None, ge=1, le=1000)
    visibility: Literal["marketplace", "private"] = "marketplace"


# ── Requirements ────────────────────────────────────────────────────────────
REQUIREMENT_RESPONSE_TYPES = ("text", "paragraph", "link", "number", "file", "image")


class RequirementIn(BaseModel):
    id: Optional[str] = None
    text: str = Field(min_length=1, max_length=2000)
    mandatory: bool = False
    weight: int = Field(default=1, ge=1, le=10)
    response_type: Literal["text", "paragraph", "link", "number", "file", "image"] = "text"


# ── Requests ───────────────────────────────────────────────────────────────
class ProposalRequestIn(BaseModel):
    type: str = Field(default="general", max_length=40)
    title: str = Field(min_length=2, max_length=200)
    description: Optional[str] = Field(default=None, max_length=20000)
    budget_range: Optional[str] = Field(default=None, max_length=120)
    budget_currency: Optional[str] = Field(default=None, max_length=8)
    budget_visible: bool = False
    deadline: Optional[str] = None  # ISO date
    submission_cap: Optional[int] = Field(default=None, ge=1, le=1000)
    requirements: list[RequirementIn] = Field(default_factory=list)
    accepted_modes: list[str] = Field(default_factory=lambda: ["general"])
    accepted_categories: Optional[list[str]] = None
    visibility: Literal["marketplace", "private"] = "marketplace"


class ProposalRequestPatch(BaseModel):
    type: Optional[str] = Field(default=None, max_length=40)
    title: Optional[str] = Field(default=None, min_length=2, max_length=200)
    description: Optional[str] = Field(default=None, max_length=20000)
    budget_range: Optional[str] = Field(default=None, max_length=120)
    budget_currency: Optional[str] = Field(default=None, max_length=8)
    budget_visible: Optional[bool] = None
    deadline: Optional[str] = None
    submission_cap: Optional[int] = Field(default=None, ge=1, le=1000)
    requirements: Optional[list[RequirementIn]] = None
    accepted_modes: Optional[list[str]] = None
    accepted_categories: Optional[list[str]] = None
    visibility: Optional[Literal["marketplace", "private"]] = None


class RequestInviteIn(BaseModel):
    emails: list[str] = Field(min_length=1, max_length=50)
    invite_url: Optional[str] = None

    @field_validator("emails", mode="before")
    @classmethod
    def _split(cls, v):
        if isinstance(v, str):
            import re
            return [p.strip() for p in re.split(r"[,;\s]+", v) if p.strip()]
        return v


# ── Submissions ────────────────────────────────────────────────────────────
class ProposalSectionIn(BaseModel):
    heading: str = Field(max_length=200)
    content: str = Field(max_length=20000)


class AttachmentIn(BaseModel):
    url: str
    filename: str = Field(max_length=300)
    mime: Optional[str] = Field(default=None, max_length=120)
    size: Optional[int] = Field(default=None, ge=0)


class RequirementResponseIn(BaseModel):
    requirement_id: str
    response: Optional[str] = Field(default=None, max_length=10000)   # text / paragraph / link / number
    attachment: Optional[AttachmentIn] = None                         # file / image


class ProposalSubmitIn(BaseModel):
    recipient_workspace_id: str
    request_id: Optional[str] = None
    title: Optional[str] = Field(default=None, max_length=200)
    summary: Optional[str] = Field(default=None, max_length=20000)
    sections: Optional[list[ProposalSectionIn]] = None
    requirement_responses: Optional[list[RequirementResponseIn]] = None
    attachments: Optional[list[AttachmentIn]] = None


class ProposalReviseIn(BaseModel):
    summary: Optional[str] = Field(default=None, max_length=20000)
    sections: Optional[list[ProposalSectionIn]] = None
    requirement_responses: Optional[list[RequirementResponseIn]] = None
    attachments: Optional[list[AttachmentIn]] = None
    note: Optional[str] = Field(default=None, max_length=2000)
    note_attachments: Optional[list[AttachmentIn]] = None  # files attached to the clarification reply


class StatusTransitionIn(BaseModel):
    status: str
    reason: Optional[str] = Field(default=None, max_length=2000)
    attachments: Optional[list[AttachmentIn]] = None  # files attached to a clarification request


class LinkRequestIn(BaseModel):
    request_id: str


# ── AI ─────────────────────────────────────────────────────────────────────
class CoverLetterIn(BaseModel):
    recipient_workspace_id: Optional[str] = None
    recipient_name: Optional[str] = Field(default=None, max_length=200)
    request_title: Optional[str] = Field(default=None, max_length=200)
    request_description: Optional[str] = Field(default=None, max_length=10000)
    generation_id: Optional[str] = None


class DescriptionIn(BaseModel):
    title: str = Field(min_length=2, max_length=200)


# ── Responses ──────────────────────────────────────────────────────────────
class GenericOk(BaseModel):
    ok: bool = True


class ListResponse(BaseModel):
    items: list[dict[str, Any]]
    total: int


class InviteResult(BaseModel):
    sent: list[str] = Field(default_factory=list)
    failed: list[str] = Field(default_factory=list)
