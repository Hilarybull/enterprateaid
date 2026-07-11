from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel

from app.core.config import get_settings
from app.core.supabase import sb_select
from app.modules.blueprint.repository import delete_document, get_document, list_documents, save_document, update_document
from app.modules.blueprint.exporter import extract_export_body, html_to_pdf, markdown_to_html, render_export_html, render_pdf_html
from app.modules.blueprint.schemas import (
    BlueprintDocument,
    BlueprintDocumentListItem,
    BlueprintDocumentUpdateRequest,
    BlueprintFinancialShareRequest,
    BlueprintFinancialShareResponse,
    BlueprintGenerateRequest,
    BlueprintGenerateResponse,
    BlueprintShareEmailRequest,
    BlueprintShareEmailResponse,
    BlueprintShareCreateRequest,
    BlueprintShareLinkResponse,
    BlueprintSharedDocument,
    QuotationRespondRequest,
)
from app.modules.blueprint.service import generate_blueprint
from app.shared.llm.openai_client import get_user_plan_info
from app.modules.blueprint.share_repository import (
    create_share_token,
    get_share_record_for_owner,
    get_shared_document_by_token,
    revoke_share_tokens,
)
from app.shared.email.sendgrid import send_document_share_email
from app.shared.auth.deps import get_current_user
from app.modules.credits.service import credit_guard

router = APIRouter(prefix="/blueprint", tags=["blueprint"])

_BLUEPRINT_CREDIT_FEATURE = {
    "business_plan": "business_plan_full",
    "client_proposal": "proposal_full",
    "sales_letter": "sales_letter_full",
}


def _shared_document_url(token: str) -> str:
    return f"{get_settings().frontend_url.rstrip('/')}/share/{token}"


def _remaining_expiry_days(expires_at: str | None) -> int:
    if not expires_at:
        return 7
    try:
        expiry = datetime.fromisoformat(str(expires_at).replace("Z", "+00:00"))
        delta = expiry - datetime.now(timezone.utc)
        return max(1, int(delta.total_seconds() // 86400) + (1 if delta.total_seconds() % 86400 else 0))
    except Exception:
        return 7


def _looks_like_markdown_text(value: str | None) -> bool:
    source = str(value or "").strip()
    if not source:
        return False
    lower = source.lower()
    if "<html" in lower or "<body" in lower:
        return False
    return (
        source.startswith("# ")
        or source.startswith("## ")
        or source.startswith("### ")
        or source.startswith("![")
        or "\n![" in source
        or "\n# " in source
        or "\n## " in source
        or "\n### " in source
        or "\n* " in source
        or "\n- " in source
        or source.startswith("**")
        or "\n**" in source
    )


def _resolved_document_html(document_html: str | None, document_markdown: str | None) -> str:
    html = str(document_html or "").strip()
    markdown = str(document_markdown or "").strip()
    if html:
        return markdown_to_html(html) if _looks_like_markdown_text(html) else html
    if markdown:
        return markdown_to_html(markdown)
    return ""


_FREE_PLAN_KEYS = {"free_trial", "explorer", "expired", ""}
_LIFETIME_BLUEPRINT_LIMIT = 1


@router.post("/generate", response_model=BlueprintGenerateResponse)
async def blueprint_generate(
    payload: BlueprintGenerateRequest,
    user=Depends(get_current_user),
) -> BlueprintGenerateResponse:
    user_id: str = user["id"]

    feature_code = _BLUEPRINT_CREDIT_FEATURE.get(payload.type)
    if feature_code:
        async with credit_guard(user_id, feature_code):
            return await generate_blueprint(payload, user_id=user_id)
    return await generate_blueprint(payload, user_id=user_id)


@router.get("/documents", response_model=list[BlueprintDocumentListItem])
async def blueprint_documents_list(
    type: str | None = Query(default=None),
    limit: int = Query(default=30, ge=1, le=100),
    user=Depends(get_current_user),
) -> list[BlueprintDocumentListItem]:
    return await list_documents(user_id=user["id"], type=type, limit=limit)


@router.get("/documents/{document_id}", response_model=BlueprintDocument)
async def blueprint_documents_get(
    document_id: str,
    user=Depends(get_current_user),
) -> BlueprintDocument:
    doc = await get_document(user_id=user["id"], document_id=document_id)
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    return doc


@router.patch("/documents/{document_id}", response_model=BlueprintDocument)
async def blueprint_documents_update(
    document_id: str,
    payload: BlueprintDocumentUpdateRequest,
    user=Depends(get_current_user),
) -> BlueprintDocument:
    doc = await update_document(user_id=user["id"], document_id=document_id, patch=payload)
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    return doc


@router.delete("/documents/{document_id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
async def blueprint_documents_delete(
    document_id: str,
    user=Depends(get_current_user),
) -> Response:
    ok = await delete_document(user_id=user["id"], document_id=document_id)
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/documents/{document_id}/share", response_model=BlueprintShareLinkResponse)
async def blueprint_documents_share_create(
    document_id: str,
    payload: BlueprintShareCreateRequest | None = None,
    user=Depends(get_current_user),
) -> BlueprintShareLinkResponse:
    payload = payload or BlueprintShareCreateRequest()
    token = await create_share_token(
        user_id=user["id"],
        document_id=document_id,
        email=payload.email,
        expires_in_days=payload.expires_in_days,
    )
    if not token:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    email_sent = False
    email_error = None
    if payload.email:
        doc = await get_document(user_id=user["id"], document_id=document_id)
        document_title = doc.title if doc else "Shared document"
        company_name = doc.company_name if doc else get_settings().app_name
        delivery = await send_document_share_email(
            to_email=payload.email,
            sender_email=user["email"],
            share_url=_shared_document_url(token),
            document_title=document_title,
            company_name=company_name,
            expires_in_days=payload.expires_in_days,
        )
        email_sent = delivery.sent
        email_error = delivery.error
    return BlueprintShareLinkResponse(token=token, email_sent=email_sent, email_error=email_error)


@router.post("/financial-documents/share", response_model=BlueprintFinancialShareResponse)
async def blueprint_financial_documents_share(
    payload: BlueprintFinancialShareRequest,
    user=Depends(get_current_user),
) -> BlueprintFinancialShareResponse:
    document_id = await save_document(
        user_id=user["id"],
        document_id=payload.document_id,
        type=payload.type,
        title=payload.title,
        company_name=payload.company_name,
        industry=payload.industry,
        pricing_model=payload.pricing_model,
        workspace_id=payload.workspace_id,
        document_markdown=payload.document_markdown,
        document_html=payload.document_html,
        provider="financials",
        model="workspace",
    )
    token = await create_share_token(
        user_id=user["id"],
        document_id=document_id,
        email=payload.email,
        expires_in_days=payload.expires_in_days,
    )
    if not token:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    email_sent = False
    email_error = None
    if payload.email:
        delivery = await send_document_share_email(
            to_email=payload.email,
            sender_email=user["email"],
            share_url=_shared_document_url(token),
            document_title=payload.title,
            company_name=payload.company_name,
            expires_in_days=payload.expires_in_days,
        )
        email_sent = delivery.sent
        email_error = delivery.error
    return BlueprintFinancialShareResponse(
        token=token,
        document_id=document_id,
        email_sent=email_sent,
        email_error=email_error,
    )


@router.delete("/documents/{document_id}/share", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
async def blueprint_documents_share_revoke(
    document_id: str,
    user=Depends(get_current_user),
) -> Response:
    ok = await revoke_share_tokens(user_id=user["id"], document_id=document_id)
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Share link not found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/share/{token}/email", response_model=BlueprintShareEmailResponse)
async def blueprint_share_send_email(
    token: str,
    payload: BlueprintShareEmailRequest,
    user=Depends(get_current_user),
) -> BlueprintShareEmailResponse:
    share = await get_share_record_for_owner(token=token, user_id=user["id"])
    if not share:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Share link not found")

    doc = await sb_select(
        "blueprint_documents",
        filters=[("id", "eq", share["document_id"]), ("user_id", "eq", user["id"])],
        single=True,
    )
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")

    delivery = await send_document_share_email(
        to_email=str(payload.email),
        sender_email=user["email"],
        share_url=_shared_document_url(token),
        document_title=str(doc.get("title") or "Shared document"),
        company_name=str(doc.get("company_name") or get_settings().app_name),
        expires_in_days=_remaining_expiry_days(share.get("expires_at")),
    )
    return BlueprintShareEmailResponse(sent=delivery.sent, error=delivery.error)


@router.get("/share/{token}", response_model=BlueprintSharedDocument)
async def blueprint_shared_document_get(token: str, email: str | None = Query(default=None)) -> BlueprintSharedDocument:
    try:
        doc = await get_shared_document_by_token(token=token, viewer_email=email)
    except RuntimeError as exc:
        if str(exc) == "EXPIRED":
            raise HTTPException(status_code=status.HTTP_410_GONE, detail="This share link has expired.")
        raise
    except PermissionError as exc:
        code = str(exc)
        if code == "EMAIL_REQUIRED":
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Email address required for this share link.")
        if code == "EMAIL_MISMATCH":
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This share link is restricted to a different email address.")
        raise
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Share link not found")
    return doc


@router.get("/share/{token}/export")
async def blueprint_shared_document_export(
    token: str,
    format: str = Query(default="pdf", pattern="^(pdf|doc)$"),
    email: str | None = Query(default=None),
):
    try:
        doc = await get_shared_document_by_token(token=token, viewer_email=email)
    except RuntimeError as exc:
        if str(exc) == "EXPIRED":
            raise HTTPException(status_code=status.HTTP_410_GONE, detail="This share link has expired.")
        raise
    except PermissionError as exc:
        code = str(exc)
        if code == "EMAIL_REQUIRED":
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Email address required for this share link.")
        if code == "EMAIL_MISMATCH":
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This share link is restricted to a different email address.")
        raise
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Share link not found")

    title = doc.title or doc.type or "document"
    raw_html = _resolved_document_html(doc.document_html, doc.document_markdown)
    body_html = extract_export_body(raw_html)
    html = render_export_html(title=title, body_html=body_html)

    safe_name = "".join(ch for ch in title.lower().replace(" ", "-") if ch.isalnum() or ch in "-_")
    safe_name = safe_name or "document"

    if format == "doc":
        return Response(
            content=html,
            media_type="application/msword",
            headers={"Content-Disposition": f'attachment; filename="{safe_name}.doc"'},
        )

    pdf_html = render_pdf_html(title=title, body_html=body_html)
    pdf_bytes = html_to_pdf(pdf_html)
    if not pdf_bytes:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="PDF export failed")
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{safe_name}.pdf"'},
    )


@router.post("/share/{token}/respond")
async def blueprint_quotation_respond(
    token: str,
    payload: QuotationRespondRequest,
    email: str | None = Query(default=None),
):
    """Public: customer accepts or rejects a shared quotation."""
    if payload.action not in ("accept", "reject"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="action must be 'accept' or 'reject'")
    viewer_email = str(payload.email or email or "").strip()
    from app.modules.marketplace.service import respond_to_quote
    return await respond_to_quote(token=token, viewer_email=viewer_email, action=payload.action)


@router.get("/documents/{document_id}/export")
async def blueprint_documents_export(
    document_id: str,
    format: str = Query(default="pdf", pattern="^(pdf|doc)$"),
    user=Depends(get_current_user),
):
    user_id: str = user["id"]
    doc = await get_document(user_id=user_id, document_id=document_id)
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")

    if doc.type == "business_plan":
        plan_key, plan_status = await get_user_plan_info(user_id)
        if plan_key in _FREE_PLAN_KEYS or plan_status in {"trial", "expired"}:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Downloading a business plan requires a paid plan. Upgrade to export.",
            )

    title = doc.title or doc.type or "document"
    raw_html = _resolved_document_html(doc.document_html, doc.document_markdown)
    body_html = extract_export_body(raw_html)
    html = render_export_html(title=title, body_html=body_html)

    safe_name = "".join(ch for ch in title.lower().replace(" ", "-") if ch.isalnum() or ch in "-_")
    safe_name = safe_name or "document"

    if format == "doc":
        return Response(
            content=html,
            media_type="application/msword",
            headers={"Content-Disposition": f'attachment; filename="{safe_name}.doc"'},
        )

    pdf_html = render_pdf_html(title=title, body_html=body_html)
    pdf_bytes = html_to_pdf(pdf_html)
    if not pdf_bytes:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="PDF export failed")
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{safe_name}.pdf"'},
    )


class FieldSuggestRequest(BaseModel):
    field: str
    company_name: str = ""
    industry: str = ""
    target_market: str = ""
    problem: str = ""
    solution: str = ""
    value_proposition: str = ""
    selected_services: list[str] = []


@router.post("/suggest-field")
async def suggest_blueprint_field(
    payload: FieldSuggestRequest,
    user=Depends(get_current_user),
) -> dict:
    from app.shared.llm.openai_client import pick_llm_for_user
    from app.modules.blueprint.service import SYSTEM_POLICY

    llm = await pick_llm_for_user(user["id"])

    svc_text = ", ".join(payload.selected_services) if payload.selected_services else ""
    ctx = (
        f"Business: {payload.company_name or 'unknown'}, "
        f"Industry: {payload.industry or 'unknown'}, "
        f"Market: {payload.target_market or 'unknown'}"
    )
    if svc_text:
        ctx += f", Services: {svc_text}"
    if payload.problem:
        ctx += f", Problem: {payload.problem}"
    if payload.solution:
        ctx += f", Solution: {payload.solution}"
    if payload.value_proposition:
        ctx += f", Value Prop: {payload.value_proposition}"

    prompts = {
        "problem": f"Write 1-2 concise sentences describing the core business problem being solved. Context: {ctx}. Return only the text, no labels.",
        "solution": f"Write 1-2 concise sentences describing the business solution/offering. Context: {ctx}. Return only the text, no labels.",
        "value_proposition": f"Write a single concise value proposition sentence (why customers choose this). Context: {ctx}. Return only the text, no labels.",
        "timeline": f"Write a brief 3-phase project timeline (Discovery, Delivery, Review) for a business proposal. Context: {ctx}. Return only the text, no labels.",
        "assumptions": f"List 3-4 key assumptions for this business proposal in plain text. Context: {ctx}. Return only the text, no labels.",
        "offer": f"Describe a compelling offer for a sales letter in 1 sentence. Context: {ctx}. Return only the text, no labels.",
        "cta": f"Write a clear call-to-action for a sales letter in 1 sentence. Context: {ctx}. Return only the text, no labels.",
        "proof": f"Write 1-2 sentences of social proof / credibility for a sales letter. Context: {ctx}. Return only the text, no labels.",
        "urgency": f"Write a concise urgency/scarcity line for a sales letter. Context: {ctx}. Return only the text, no labels.",
        "proposal_title": f"Suggest a professional business proposal title. Context: {ctx}. Return only the title, no labels.",
        "about_company": f"Write a 2-3 sentence company overview describing what it does, who it serves, and its edge. Context: {ctx}. Return only the text, no labels.",
        "tagline": f"Write a punchy one-line business tagline (max 10 words). Context: {ctx}. Return only the tagline, no labels.",
        "vision": f"Write a one-sentence company vision statement describing the future the company wants to create. Context: {ctx}. Return only the text, no labels.",
        "mission": f"Write a one-sentence company mission statement describing how it achieves its vision. Context: {ctx}. Return only the text, no labels.",
        "core_values": f"List 4-5 short company core values as comma-separated words or short phrases. Context: {ctx}. Return only the comma-separated list, no labels.",
    }

    prompt = prompts.get(
        payload.field,
        f"Provide a short, professional text for the '{payload.field}' field. Context: {ctx}. Return only the text, no labels.",
    )

    async with credit_guard(user["id"], "suggest_field"):
        try:
            res = await llm.generate_text(system=SYSTEM_POLICY, prompt=prompt, feature="blueprint.suggest_field")
            text = (res.text or "").strip()
            return {"value": text}
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"AI suggestion failed: {e}")
