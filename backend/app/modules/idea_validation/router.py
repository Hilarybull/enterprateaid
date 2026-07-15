from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Response
from pydantic import BaseModel
from typing import Optional
from app.modules.idea_validation.schemas import (
    CreateValidationWorkspaceRequest,
    CreateWorkspaceResponse,
    EvaluateRequest,
    MarketResearchRequest,
    UpdateWorkspaceRequest,
    ValidationResult,
    WorkspaceResponse,
)
from app.modules.idea_validation.service import (
    create_workspace,
    evaluate,
    get_user_workspace,
    get_workspace,
    market_fit,
    update_workspace,
    upsert_user_workspace,
)
from app.modules.idea_validation.market_research_service import (
    flatten_fields_from_payload,
    run_market_research,
    _call_claude,
    _call_openai,
)
from app.shared.auth.deps import get_current_user
from app.modules.credits.service import credit_guard

router = APIRouter(prefix="/validation", tags=["idea_validation"])


@router.get("/market-fit")
async def market_fit_endpoint(
    keyword: str = Query(min_length=2),
    industry: str = Query(default="general"),
    location: str = Query(default="London"),
    uk_region: str = Query(default="GB-ENG"),
    sic_code: str | None = Query(default=None),
    radius_metres: int = Query(default=5000, ge=1000, le=50000),
    user=Depends(get_current_user),
) -> dict:
    # Auth required (same as validation); user id currently not used.
    _ = user
    return await market_fit(
        keyword=keyword,
        industry=industry,
        location=location,
        uk_region=uk_region,
        sic_code=sic_code,
        radius_metres=radius_metres,
    )


@router.post("/create", response_model=CreateWorkspaceResponse)
async def create_validation_workspace(
    payload: CreateValidationWorkspaceRequest,
    user=Depends(get_current_user),
) -> CreateWorkspaceResponse:
    workspace_id = await create_workspace(user_id=user["id"], name=payload.name, data=payload.data)
    ws = await get_workspace(user_id=user["id"], workspace_id=workspace_id)
    return CreateWorkspaceResponse(id=str(ws.id), name=ws.name, created_at=ws.created_at)


@router.get("/me", response_model=WorkspaceResponse)
async def get_my_workspace(
    user=Depends(get_current_user),
) -> WorkspaceResponse:
    ws = await get_user_workspace(user_id=user["id"])
    if not ws:
        return Response(status_code=204)
    return WorkspaceResponse.from_doc(ws)


@router.get("/{workspace_id}", response_model=WorkspaceResponse)
async def get_validation_workspace(
    workspace_id: str,
    user=Depends(get_current_user),
) -> WorkspaceResponse:
    ws = await get_workspace(user_id=user["id"], workspace_id=workspace_id)
    return WorkspaceResponse.from_doc(ws)


@router.post("/evaluate", response_model=ValidationResult)
async def evaluate_validation(
    payload: EvaluateRequest,
    user=Depends(get_current_user),
) -> ValidationResult:
    async with credit_guard(user["id"], "idea_validation"):
        result = await evaluate(
            user_id=user["id"],
            workspace_id=payload.workspace_id,
            inputs=payload.inputs,
            idea_validation=payload.idea_validation,
        )
    return ValidationResult(**result)


@router.patch("/me", response_model=WorkspaceResponse)
async def patch_my_workspace(
    payload: UpdateWorkspaceRequest,
    user=Depends(get_current_user),
) -> WorkspaceResponse:
    ws = await upsert_user_workspace(user_id=user["id"], data_patch=payload.data, name=payload.name)
    return WorkspaceResponse.from_doc(ws)


@router.patch("/{workspace_id}", response_model=WorkspaceResponse)
async def patch_validation_workspace(
    workspace_id: str,
    payload: UpdateWorkspaceRequest,
    user=Depends(get_current_user),
) -> WorkspaceResponse:
    ws = await update_workspace(
        user_id=user["id"],
        workspace_id=workspace_id,
        data_patch=payload.data,
        name=payload.name,
    )
    return WorkspaceResponse.from_doc(ws)


class FieldSuggestRequest(BaseModel):
    field: str
    description: Optional[str] = ""
    problem: Optional[str] = ""
    alternatives: Optional[str] = ""
    solution: Optional[str] = ""
    segment: Optional[str] = ""
    location: Optional[str] = ""
    industry: Optional[str] = ""
    sector: Optional[str] = ""
    country: Optional[str] = ""


_FIELD_PROMPTS = {
    "description": (
        "You are a startup advisor. Suggest a clear, one-sentence business idea for a founder. "
        "Segment: {segment}. Location: {location}. "
        'Respond in JSON only: {{"suggestion": "<your suggestion, max 30 words>"}}'
    ),
    "problem": (
        "Suggest a concise problem statement for this business idea: '{description}'. "
        "Target segment: {segment}. "
        'Respond in JSON only: {{"suggestion": "<problem text, max 25 words>"}}'
    ),
    "alternatives": (
        "For the business idea '{description}' solving '{problem}', briefly describe how people currently "
        "solve this problem without the new solution. "
        'Respond in JSON only: {{"suggestion": "<alternatives text, max 25 words>"}}'
    ),
    "solution": (
        "For the business idea '{description}' solving '{problem}', where current alternatives are '{alternatives}', "
        "suggest how this solution is better in one sentence. "
        'Respond in JSON only: {{"suggestion": "<solution text, max 30 words>"}}'
    ),
    # Service / product form fields
    "service_description": (
        "You are a startup advisor. Write a clear one-sentence description for a product or service called '{description}'. "
        "Target segment: {segment}. Industry: {industry}. Country: {country}. "
        'Respond in JSON only: {{"suggestion": "<description, max 30 words>"}}'
    ),
    "service_problem": (
        "You are a startup advisor. "
        "Product/service: '{description}'. Industry: {industry}{sector_part}. Target customers: {segment}. Country: {country}. "
        "Suggest the single most likely pain point this product/service solves for those customers in that industry. "
        "Base your answer strictly on the product/service and industry above — do not invent an unrelated problem. "
        'Respond in JSON only: {{"suggestion": "<problem text, max 25 words>"}}'
    ),
    "service_alternatives": (
        "You are a startup advisor. "
        "Product/service: '{description}'. Industry: {industry}{sector_part}. Target customers: {segment}. Country: {country}. "
        "Name the actual tools, competitors, or workarounds those customers currently use for this specific need in the {industry} space. "
        "Base your answer strictly on the product/service and industry — do not suggest tools from an unrelated industry. "
        'Respond in JSON only: {{"suggestion": "<alternatives text, max 25 words>"}}'
    ),
    "service_differentiator": (
        "You are a startup advisor. "
        "Product/service: '{description}'. Industry: {industry}{sector_part}. Target customers: {segment}. Country: {country}. "
        "Current alternatives: '{alternatives}'. "
        "Suggest the single strongest reason customers in the {industry} space would choose this over those alternatives. "
        "Base your answer on the product/service and industry context. "
        'Respond in JSON only: {{"suggestion": "<differentiator text, max 25 words>"}}'
    ),
}


@router.post("/suggest-field")
async def suggest_field(
    payload: FieldSuggestRequest,
    user=Depends(get_current_user),
) -> dict:
    template = _FIELD_PROMPTS.get(payload.field)
    if not template:
        return {"suggestion": ""}
    industry = payload.industry or payload.location or "the relevant industry"
    sector = payload.sector or ""
    sector_part = f" / {sector}" if sector else ""
    prompt = template.format(
        description=payload.description or "",
        problem=payload.problem or "",
        alternatives=payload.alternatives or "",
        solution=payload.solution or "",
        segment=payload.segment or "general audience",
        location=payload.country or payload.location or "the target market",
        industry=industry,
        sector_part=sector_part,
        country=payload.country or payload.location or "their market",
    )
    async with credit_guard(user["id"], "suggest_field"):
        try:
            result = await _call_claude(prompt, user_id=user["id"], feature="validation.suggest_field")
            suggestion = result.get("suggestion") or result.get("text") or ""
        except Exception:
            try:
                result = await _call_openai(prompt, user_id=user["id"], feature="validation.suggest_field")
                suggestion = result.get("suggestion") or result.get("text") or ""
            except Exception:
                suggestion = ""
    return {"suggestion": suggestion.strip()}


@router.post("/market-research")
async def market_research_endpoint(
    payload: MarketResearchRequest,
    user=Depends(get_current_user),
) -> dict:
    if payload.idea_validation:
        fields = flatten_fields_from_payload(payload.idea_validation)
    elif payload.workspace_id:
        ws = await get_workspace(user_id=user["id"], workspace_id=payload.workspace_id)
        ws_data = ws.data or {}
        iv = ws_data.get("idea_validation") or ws_data.get("draft_idea_validation") or {}
        fields = flatten_fields_from_payload(iv)
    else:
        fields = {}
    async with credit_guard(user["id"], "market_data_refresh"):
        return await run_market_research(fields, user_id=user["id"])
