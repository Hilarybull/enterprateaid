from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status

logger = logging.getLogger(__name__)
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
from app.shared.email.resend import send_document_share_email
from app.shared.auth.deps import get_current_user
from app.modules.credits.service import credit_guard
from app.modules.credits.service import _has_platform_grant

router = APIRouter(prefix="/blueprint", tags=["blueprint"])


def _shared_document_url(token: str, *, viewer_email: str | None = None) -> str:
    from urllib.parse import urlencode
    settings = get_settings()
    # Prefer the backend URL so the /share/{token} preview endpoint can serve
    # dynamic OG meta tags for WhatsApp/Slack link previews.  Fall back to the
    # frontend URL if BACKEND_URL is not configured.
    base = (settings.backend_url or settings.frontend_url).rstrip("/")
    url = f"{base}/share/{token}"
    if viewer_email:
        url += "?" + urlencode({"email": viewer_email})
    return url


def _remaining_expiry_days(expires_at: str | None) -> int | None:
    if not expires_at:
        return None  # no expiry
    try:
        expiry = datetime.fromisoformat(str(expires_at).replace("Z", "+00:00"))
        delta = expiry - datetime.now(timezone.utc)
        return max(1, int(delta.total_seconds() // 86400) + (1 if delta.total_seconds() % 86400 else 0))
    except Exception:
        return None


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

# Hard server-side ceiling on a single generation. Without this, a stuck/slow LLM
# call ran forever: the client would eventually give up (or the user would just
# close the tab) while the backend kept working in the background, credits still
# got committed on eventual completion, and the document could still get saved
# minutes after the user was shown a failure. Bounding it here means a stuck
# generation now fails fast and reliably, and credit_guard's existing
# finally-block releases the reserved credits instead of committing them.
_GENERATION_TIMEOUT_SECONDS = 150


def _blueprint_feature_code(doc_type: str, sections: list[str] | None) -> str:
    is_section = bool(sections and len(sections) == 1)
    if doc_type == "business_plan":
        return "business_plan_section" if is_section else "business_plan_full"
    if doc_type == "client_proposal":
        return "proposal_section" if is_section else "proposal_full"
    if doc_type == "sales_letter":
        return "sales_letter_section" if is_section else "sales_letter_full"
    return "business_plan_full"


@router.post("/generate", response_model=BlueprintGenerateResponse)
async def blueprint_generate(
    payload: BlueprintGenerateRequest,
    user=Depends(get_current_user),
) -> BlueprintGenerateResponse:
    user_id: str = user["id"]

    if payload.type == "business_plan":
        plan_key, plan_status = await get_user_plan_info(user_id)
        has_blueprint_grant = await _has_platform_grant(user_id, "business_plan")
        if (plan_key in _FREE_PLAN_KEYS or plan_status in {"trial", "expired"}) and not has_blueprint_grant:
            existing = await list_documents(user_id=user_id, type="business_plan", limit=2)
            if len(existing) >= _LIFETIME_BLUEPRINT_LIMIT:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="You have used your free lifetime business plan. Upgrade to generate more.",
                )

    feature_code = _blueprint_feature_code(payload.type, payload.sections)
    logger.info("blueprint-generate start user=%s type=%s", user_id, payload.type)
    try:
        async with credit_guard(user_id, feature_code, payload.generation_id):
            result = await asyncio.wait_for(
                generate_blueprint(payload, user_id=user_id),
                timeout=_GENERATION_TIMEOUT_SECONDS,
            )
        logger.info("blueprint-generate complete user=%s type=%s", user_id, payload.type)
        return result
    except HTTPException:
        raise
    except asyncio.TimeoutError as exc:
        logger.error(
            "blueprint-generate TIMEOUT user=%s type=%s after %ss",
            user_id, payload.type, _GENERATION_TIMEOUT_SECONDS,
        )
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail="Generation timed out. Your credits were not charged — please try again.",
        ) from exc
    except Exception as exc:
        logger.exception("blueprint-generate UNHANDLED ERROR user=%s type=%s: %s", user_id, payload.type, exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Generation failed: {type(exc).__name__}: {exc}",
        ) from exc


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
        document_type = doc.type if doc else "document"
        sender_email = str(payload.sender_email or user["email"]).strip()
        async with credit_guard(user["id"], "email_share"):
            delivery = await send_document_share_email(
                to_email=payload.email,
                sender_email=sender_email,
                share_url=_shared_document_url(token, viewer_email=payload.email),
                document_title=document_title,
                company_name=company_name,
                expires_in_days=payload.expires_in_days,
                document_type=document_type,
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
    # Plain financial documents (invoices, quotations, receipts) are never locked to a
    # recipient's email — the address is only used to deliver the link. Interactive
    # workflow shares (quotation acceptance, RFQ rejection) keep the email restriction.
    _doc_type = str(payload.type or "")
    _lock_to_email = payload.email
    if _doc_type in {"invoice_template", "sales_quotation", "receipt"}:
        _lock_to_email = None
    token = await create_share_token(
        user_id=user["id"],
        document_id=document_id,
        email=_lock_to_email,
        expires_in_days=payload.expires_in_days,
    )
    if not token:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    email_sent = False
    email_error = None
    if payload.email:
        try:
            sender_email = str(payload.sender_email or user["email"]).strip()
            delivery = await send_document_share_email(
                to_email=payload.email,
                sender_email=sender_email,
                share_url=_shared_document_url(token, viewer_email=payload.email),
                document_title=payload.title,
                company_name=payload.company_name,
                expires_in_days=payload.expires_in_days,
                document_type=payload.type,
            )
            email_sent = delivery.sent
            email_error = delivery.error
        except Exception as exc:
            email_sent = False
            email_error = str(exc)
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

    # Sending a share link by email is a plain transactional email and is not
    # credit-gated (mirrors financial-documents/share, which emails the link for free).
    delivery = await send_document_share_email(
        to_email=str(payload.email),
        sender_email=str(payload.sender_email or user["email"]).strip(),
        share_url=_shared_document_url(token, viewer_email=str(payload.email)),
        document_title=str(doc.get("title") or "Shared document"),
        company_name=str(doc.get("company_name") or get_settings().app_name),
        expires_in_days=_remaining_expiry_days(share.get("expires_at")),
        document_type=str(doc.get("type") or "document"),
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
        has_blueprint_grant = await _has_platform_grant(user_id, "business_plan_full")
        if (plan_key in _FREE_PLAN_KEYS or plan_status in {"trial", "expired"}) and not has_blueprint_grant:
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


class ExportPdfFromHtmlRequest(BaseModel):
    html: str
    title: str = "Business Plan"
    document_id: str = ""


@router.post("/documents/export-pdf")
async def blueprint_export_pdf_from_html(
    body: ExportPdfFromHtmlRequest,
    user=Depends(get_current_user),
):
    """Accept pre-rasterized HTML from the frontend and return a PDF blob."""
    user_id: str = user["id"]

    if body.document_id:
        doc = await get_document(user_id=user_id, document_id=body.document_id)
        if doc and doc.type == "business_plan":
            plan_key, plan_status = await get_user_plan_info(user_id)
            has_blueprint_grant = await _has_platform_grant(user_id, "business_plan_full")
            if (plan_key in _FREE_PLAN_KEYS or plan_status in {"trial", "expired"}) and not has_blueprint_grant:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Downloading a business plan requires a paid plan. Upgrade to export.",
                )

    body_html = extract_export_body(body.html)
    pdf_html = render_pdf_html(title=body.title, body_html=body_html)
    pdf_bytes = html_to_pdf(pdf_html)
    if not pdf_bytes:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="PDF export failed")

    safe_name = "".join(ch for ch in body.title.lower().replace(" ", "-") if ch.isalnum() or ch in "-_")
    safe_name = safe_name or "document"
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
        "about_company": f"Write a 2-3 sentence company overview describing what it does, who it serves, and its edge. Context: {ctx}. Return only the text, no labels, no markdown.",
        "tagline": f"Write a punchy one-line business tagline (max 10 words). Context: {ctx}. Return only the tagline, no labels, no markdown.",
        "vision": f"Write a one-sentence company vision statement describing the future the company wants to create. Context: {ctx}. Return only the text, no labels, no markdown.",
        "mission": f"Write a one-sentence company mission statement describing how it achieves its vision. Context: {ctx}. Return only the text, no labels, no markdown.",
        "core_values": f"List 4-5 short company core values as comma-separated words or short phrases. Context: {ctx}. Return only the comma-separated list, no labels, no markdown.",
    }

    prompt = prompts.get(
        payload.field,
        f"Provide a short, professional text for the '{payload.field}' field. Context: {ctx}. Return only the text, no labels, no markdown.",
    )

    try:
        async with credit_guard(user["id"], "suggest_field"):
            res = await llm.generate_text(system=SYSTEM_POLICY, prompt=prompt, feature="blueprint.suggest_field")
        import re as _re
        text = _re.sub(r"\*{1,3}|_{1,3}|^[-–—]\s*", "", (res.text or ""), flags=_re.MULTILINE).strip()
        return {"value": text}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI suggestion failed: {e}")
