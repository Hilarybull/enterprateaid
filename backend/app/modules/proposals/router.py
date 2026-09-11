from __future__ import annotations

from uuid import uuid4

import anyio
from fastapi import APIRouter, Depends, File, Header, HTTPException, Query, Request, Response, UploadFile, status

from app.core.supabase import get_supabase_client
from app.shared.auth.deps import get_current_user, get_optional_user
from app.modules.proposals import service
from app.modules.proposals.extraction import extract_brief_text
from app.modules.proposals.schemas import (
    CoverLetterIn,
    DescriptionIn,
    LinkRequestIn,
    ProposalPreferences,
    ProposalRequestIn,
    ProposalRequestPatch,
    ProposalReviseIn,
    ProposalSubmitIn,
    RequestInviteIn,
    StatusTransitionIn,
)

router = APIRouter(prefix="/proposals", tags=["proposals"])

ATTACHMENT_BUCKET = "proposal-attachments"
_ALLOWED_ATTACHMENT_EXT = {
    "pdf", "doc", "docx", "txt", "rtf", "md", "csv", "xls", "xlsx", "ppt", "pptx",
    "png", "jpg", "jpeg", "webp", "gif", "zip",
}
_MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024
_MAX_BRIEF_BYTES = 10 * 1024 * 1024


# ── Preferences ────────────────────────────────────────────────────────────
@router.get("/preferences")
async def get_preferences(user=Depends(get_current_user)):
    return await service.get_preferences(user_id=user["id"])


@router.put("/preferences")
async def put_preferences(payload: ProposalPreferences, user=Depends(get_current_user)):
    return await service.save_preferences(user_id=user["id"], prefs=payload)


# ── Requests (recipient) ──────────────────────────────────────────────────
@router.get("/requests")
async def list_requests(user=Depends(get_current_user)):
    return await service.list_requests(user_id=user["id"])


@router.post("/requests", status_code=status.HTTP_201_CREATED)
async def create_request(payload: ProposalRequestIn, user=Depends(get_current_user)):
    return await service.create_request(user_id=user["id"], payload=payload)


@router.patch("/requests/{request_id}")
async def patch_request(request_id: str, payload: ProposalRequestPatch, user=Depends(get_current_user)):
    return await service.patch_request(user_id=user["id"], request_id=request_id, payload=payload)


@router.post("/requests/{request_id}/publish")
async def publish_request(request_id: str, user=Depends(get_current_user)):
    return await service.set_request_status(user_id=user["id"], request_id=request_id, action="publish")


@router.post("/requests/{request_id}/close")
async def close_request(request_id: str, user=Depends(get_current_user)):
    return await service.set_request_status(user_id=user["id"], request_id=request_id, action="close")


@router.post("/requests/{request_id}/reopen")
async def reopen_request(request_id: str, user=Depends(get_current_user)):
    return await service.set_request_status(user_id=user["id"], request_id=request_id, action="reopen")


@router.delete("/requests/{request_id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
async def delete_request(request_id: str, user=Depends(get_current_user)) -> Response:
    await service.delete_request(user_id=user["id"], request_id=request_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/requests/{request_id}/invite")
async def invite_request(request_id: str, payload: RequestInviteIn, user=Depends(get_current_user)):
    return await service.invite_to_request(
        user_id=user["id"], request_id=request_id, emails=payload.emails, invite_url=payload.invite_url,
    )


# ── Public request discovery (proposer) ──────────────────────────────────
@router.get("/public/requests")
async def public_requests(
    search: str | None = Query(default=None),
    type: str | None = Query(default=None),
):
    return await service.list_public_requests(search=search, type_filter=type)


@router.get("/public/requests/{request_id}")
async def public_request_detail(
    request_id: str,
    request: Request,
    user=Depends(get_optional_user),
    x_visitor_id: str | None = Header(default=None, convert_underscores=True),
):
    # Unique-view dedup key: the signed-in user, or a client-generated anonymous
    # id (localStorage, sent by the frontend) if not signed in. Falls back to the
    # caller's IP only when neither is present, so a view still gets counted.
    if user:
        viewer_key = f"user:{user['id']}"
    elif x_visitor_id and x_visitor_id.strip():
        viewer_key = f"anon:{x_visitor_id.strip()[:128]}"
    else:
        viewer_key = f"ip:{request.client.host if request.client else 'unknown'}"
    return await service.get_public_request(request_id=request_id, user_id=user["id"] if user else None, viewer_key=viewer_key)


# ── Submission (proposer) ────────────────────────────────────────────────
@router.post("/submit", status_code=status.HTTP_201_CREATED)
async def submit_proposal(payload: ProposalSubmitIn, user=Depends(get_current_user)):
    return await service.submit_proposal(
        user_id=user["id"], user_email=user.get("email") or user["id"], payload=payload,
    )


@router.post("/{proposal_id}/revise")
async def revise_proposal(proposal_id: str, payload: ProposalReviseIn, user=Depends(get_current_user)):
    return await service.revise_proposal(user_id=user["id"], proposal_id=proposal_id, payload=payload)


# ── Inbox (recipient) ────────────────────────────────────────────────────
@router.get("/inbox")
async def list_inbox(user=Depends(get_current_user)):
    return await service.list_inbox(user_id=user["id"])


@router.delete("/inbox/{proposal_id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
async def delete_from_inbox(proposal_id: str, user=Depends(get_current_user)) -> Response:
    await service.hide_from_inbox(user_id=user["id"], proposal_id=proposal_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.patch("/inbox/{proposal_id}/link")
async def link_to_request(proposal_id: str, payload: LinkRequestIn, user=Depends(get_current_user)):
    return await service.link_proposal_to_request(
        user_id=user["id"], proposal_id=proposal_id, request_id=payload.request_id,
    )


# ── Activity (proposer) ──────────────────────────────────────────────────
@router.get("/activity")
async def list_activity(user=Depends(get_current_user)):
    return await service.list_activity(user_id=user["id"])


# ── Single proposal + status ─────────────────────────────────────────────
@router.get("/{proposal_id}")
async def get_proposal(proposal_id: str, user=Depends(get_current_user)):
    return await service.get_proposal(user_id=user["id"], proposal_id=proposal_id)


@router.post("/{proposal_id}/status")
async def transition_status(proposal_id: str, payload: StatusTransitionIn, user=Depends(get_current_user)):
    return await service.transition_status(
        user_id=user["id"], proposal_id=proposal_id, target=payload.status, reason=payload.reason,
        attachments=payload.attachments,
    )


# ── File operations ──────────────────────────────────────────────────────
def _ensure_bucket() -> None:
    client = get_supabase_client()
    try:
        buckets = client.storage.list_buckets()
        names = [b.name for b in (buckets or [])]
        if ATTACHMENT_BUCKET not in names:
            client.storage.create_bucket(ATTACHMENT_BUCKET, options={"public": True})
    except Exception:
        pass


@router.post("/upload-attachment")
async def upload_attachment(file: UploadFile = File(...), user=Depends(get_current_user)):
    ext = (file.filename or "").rsplit(".", 1)[-1].lower() if "." in (file.filename or "") else ""
    if ext not in _ALLOWED_ATTACHMENT_EXT:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported file type.")
    data = await file.read()
    if len(data) > _MAX_ATTACHMENT_BYTES:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="File is larger than 15 MB.")
    path = f"{user['id']}/{uuid4().hex}.{ext}"
    mime = file.content_type or "application/octet-stream"

    def _upload():
        _ensure_bucket()
        client = get_supabase_client()
        client.storage.from_(ATTACHMENT_BUCKET).upload(
            path, data, file_options={"content-type": mime, "upsert": "true"}
        )
        return client.storage.from_(ATTACHMENT_BUCKET).get_public_url(path)

    url = await anyio.to_thread.run_sync(_upload)
    return {"url": url, "filename": file.filename, "mime": mime, "size": len(data)}


@router.post("/extract-brief")
async def extract_brief(file: UploadFile = File(...), _user=Depends(get_current_user)):
    data = await file.read()
    if len(data) > _MAX_BRIEF_BYTES:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="File is larger than 10 MB.")
    try:
        text = await anyio.to_thread.run_sync(
            lambda: extract_brief_text(filename=file.filename or "", content_type=file.content_type, data=data)
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc))
    return {"text": text}


# ── AI ───────────────────────────────────────────────────────────────────
@router.post("/generate-cover-letter")
async def generate_cover_letter(payload: CoverLetterIn, user=Depends(get_current_user)):
    text = await service.generate_cover_letter(user_id=user["id"], payload=payload)
    return {"cover_letter": text}


@router.post("/generate-description")
async def generate_description(payload: DescriptionIn, user=Depends(get_current_user)):
    text = await service.generate_description(user_id=user["id"], title=payload.title)
    return {"description": text}
