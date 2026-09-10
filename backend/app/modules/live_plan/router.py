from __future__ import annotations

import base64
import io
import xml.etree.ElementTree as _ET
import zipfile

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status

from app.modules.credits.service import credit_guard
from app.core.config import get_settings
from app.shared.auth.deps import get_current_user
from app.modules.live_plan.schemas import (
    LivePlanAdoptRequest,
    LivePlanImportExtractRequest,
    LivePlanConfirmAdoptRequest,
    LivePlanAlertResponse,
    LivePlanCompareResponse,
    LivePlanCreateRequest,
    LivePlanKPICreateRequest,
    LivePlanKPIListResponse,
    LivePlanKPIUpdateRequest,
    LivePlanNarrativeRefreshRequest,
    LivePlanPerformanceResponse,
    LivePlanResponse,
    LivePlanScenarioAdoptRequest,
    LivePlanVarianceResponse,
)
from app.modules.live_plan.service import (
    activate_live_plan,
    import_extract_plan,
    confirm_adopt_plan,
    acknowledge_alert,
    adopt_scenario,
    build_performance,
    compare_versions,
    get_existing_live_plan,
    ensure_live_plan,
    get_live_plan,
    get_version,
    list_alerts,
    list_kpis,
    list_variances,
    list_versions,
    patch_kpi,
    refresh_narrative,
    upsert_kpi,
)

router = APIRouter(prefix="/businesses/{business_id}/live-plan", tags=["live-plan"])


@router.post("", response_model=LivePlanResponse)
async def create_live_plan(
    business_id: str,
    payload: LivePlanCreateRequest | None = None,
    user=Depends(get_current_user),
) -> LivePlanResponse:
    payload = payload or LivePlanCreateRequest()
    # Initial plan seeding is deterministic; AI extraction is not performed here.
    await ensure_live_plan(user_id=user["id"], business_id=business_id, source_document_id=payload.source_document_id)
    return LivePlanResponse(
        business_id=business_id,
        plan=await get_live_plan(user_id=user["id"], business_id=business_id),
    )


@router.get("", response_model=LivePlanResponse)
async def get_live_plan_endpoint(
    business_id: str,
    user=Depends(get_current_user),
) -> LivePlanResponse:
    try:
        plan = await get_live_plan(user_id=user["id"], business_id=business_id)
    except ValueError as exc:
        if str(exc) == "LIVE_PLAN_NOT_FOUND":
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Live plan not found")
        raise
    return LivePlanResponse(business_id=business_id, plan=plan)


@router.post("/adopt", response_model=LivePlanResponse)
async def adopt_live_plan_endpoint(
    business_id: str,
    payload: LivePlanAdoptRequest | None = None,
    user=Depends(get_current_user),
) -> LivePlanResponse:
    payload = payload or LivePlanAdoptRequest()
    async with credit_guard(user["id"], "live_plan_scenario_adopt", payload.idempotency_key):
        plan = await activate_live_plan(user_id=user["id"], business_id=business_id)
    return LivePlanResponse(business_id=business_id, plan=plan)


@router.post("/import-extract")
async def import_extract_live_plan(
    business_id: str,
    payload: LivePlanImportExtractRequest | None = None,
    dry_run: bool = Query(False, description="If true, extract and preview without writing to DB"),
    user=Depends(get_current_user),
) -> dict:
    """Adopt a blueprint document or raw text — AI extracts fields and seeds the live plan."""
    payload = payload or LivePlanImportExtractRequest()
    if dry_run:
        result = await import_extract_plan(
            user_id=user["id"],
            business_id=business_id,
            document_id=payload.document_id,
            raw_content=payload.raw_content,
            dry_run=True,
        )
        return {"business_id": business_id, **result}
    async with credit_guard(user["id"], "live_plan_import_extract", payload.idempotency_key):
        result = await import_extract_plan(
            user_id=user["id"],
            business_id=business_id,
            document_id=payload.document_id,
            raw_content=payload.raw_content,
        )
    return {"business_id": business_id, **result}


@router.post("/confirm-adopt")
async def confirm_adopt_live_plan(
    business_id: str,
    payload: LivePlanConfirmAdoptRequest,
    user=Depends(get_current_user),
) -> dict:
    """Write pre-extracted data to DB after the user reviews and confirms the preview."""
    result = await confirm_adopt_plan(
        user_id=user["id"],
        business_id=business_id,
        extracted=payload.extracted,
        markdown=payload.markdown,
        doc_title=payload.source_title,
        document_id=payload.document_id,
    )
    return {"business_id": business_id, **result}


@router.post("/import-file")
async def import_file_live_plan(
    business_id: str,
    file: UploadFile = File(...),
    dry_run: bool = Query(False, description="If true, extract and preview without writing to DB"),
    user=Depends(get_current_user),
) -> dict:
    """Upload a PDF, Word doc, image, or text file and extract a live plan from it."""
    content = await file.read()
    filename = (file.filename or "").lower()
    ext = filename.rsplit(".", 1)[-1] if "." in filename else ""

    raw_content: str | None = None

    if ext in ("txt", "md"):
        raw_content = content.decode("utf-8", errors="replace")

    elif ext == "pdf":
        try:
            from pypdf import PdfReader
            reader = PdfReader(io.BytesIO(content))
            pages = [page.extract_text() or "" for page in reader.pages]
            raw_content = "\n\n".join(p for p in pages if p.strip())
        except Exception as exc:
            raise HTTPException(status_code=422, detail=f"Could not read PDF: {exc}")

    elif ext == "docx":
        try:
            with zipfile.ZipFile(io.BytesIO(content)) as z:
                xml_bytes = z.read("word/document.xml")
            root = _ET.fromstring(xml_bytes)
            ns_t = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}t"
            texts = [el.text or "" for el in root.iter(ns_t)]
            raw_content = " ".join(t for t in texts if t.strip())
        except Exception as exc:
            raise HTTPException(status_code=422, detail=f"Could not read Word document: {exc}")

    elif ext in ("jpg", "jpeg", "png", "webp", "gif"):
        settings = get_settings()
        if not settings.openai_api_key:
            raise HTTPException(status_code=503, detail="Vision extraction not configured")
        mime = file.content_type or f"image/{ext}"
        b64 = base64.b64encode(content).decode()
        import httpx as _httpx
        payload = {
            "model": "gpt-4o",
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": "Extract and return all the text from this business plan document image. Return only the extracted text, nothing else."},
                        {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64}"}},
                    ],
                }
            ],
            "max_tokens": 4000,
        }
        async with _httpx.AsyncClient(timeout=120) as cli:
            resp = await cli.post(
                "https://api.openai.com/v1/chat/completions",
                json=payload,
                headers={"Authorization": f"Bearer {settings.openai_api_key}"},
            )
            resp.raise_for_status()
        raw_content = resp.json()["choices"][0]["message"]["content"]
    else:
        raise HTTPException(status_code=415, detail=f"Unsupported file type: .{ext}. Upload a PDF, Word (.docx), image (JPG/PNG/WEBP), or plain text file.")

    if not raw_content or not raw_content.strip():
        raise HTTPException(status_code=422, detail="No text could be extracted from the uploaded file.")

    if dry_run:
        result = await import_extract_plan(
            user_id=user["id"],
            business_id=business_id,
            raw_content=raw_content,
            dry_run=True,
        )
        return {"business_id": business_id, **result}
    async with credit_guard(user["id"], "live_plan_import_extract", None):
        result = await import_extract_plan(
            user_id=user["id"],
            business_id=business_id,
            raw_content=raw_content,
        )
    return {"business_id": business_id, **result}


@router.get("/versions")
async def live_plan_versions_endpoint(
    business_id: str,
    user=Depends(get_current_user),
) -> dict:
    versions = await list_versions(user_id=user["id"], business_id=business_id)
    return {"business_id": business_id, "versions": versions}


@router.get("/versions/compare", response_model=LivePlanCompareResponse)
async def live_plan_version_compare(
    business_id: str,
    version_a: str = Query(...),
    version_b: str = Query(...),
    user=Depends(get_current_user),
) -> LivePlanCompareResponse:
    comparison = await compare_versions(user_id=user["id"], business_id=business_id, version_a=version_a, version_b=version_b)
    return LivePlanCompareResponse(business_id=business_id, version_a=version_a, version_b=version_b, comparison=comparison)


@router.get("/versions/{version_id}")
async def live_plan_version_get(
    business_id: str,
    version_id: str,
    user=Depends(get_current_user),
) -> dict:
    try:
        version = await get_version(user_id=user["id"], business_id=business_id, version_id=version_id)
        return {"business_id": business_id, "version": version}
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Version not found")


@router.get("/kpis", response_model=LivePlanKPIListResponse)
async def live_plan_kpis_list(
    business_id: str,
    user=Depends(get_current_user),
) -> LivePlanKPIListResponse:
    kpis = await list_kpis(user_id=user["id"], business_id=business_id)
    return LivePlanKPIListResponse(business_id=business_id, kpis=kpis)


@router.post("/kpis")
async def live_plan_kpi_create(
    business_id: str,
    payload: LivePlanKPICreateRequest,
    user=Depends(get_current_user),
) -> dict:
    async with credit_guard(user["id"], "live_plan_kpi_refresh", payload.idempotency_key):
        kpi = await upsert_kpi(user_id=user["id"], business_id=business_id, payload=payload.model_dump())
    return {"business_id": business_id, "kpi": kpi}


@router.patch("/kpis/{kpi_id}")
async def live_plan_kpi_patch(
    business_id: str,
    kpi_id: str,
    payload: LivePlanKPIUpdateRequest,
    user=Depends(get_current_user),
) -> dict:
    async with credit_guard(user["id"], "live_plan_kpi_refresh", payload.idempotency_key):
        kpi = await patch_kpi(user_id=user["id"], business_id=business_id, kpi_id=kpi_id, payload=payload.model_dump())
    return {"business_id": business_id, "kpi": kpi}


@router.get("/performance", response_model=LivePlanPerformanceResponse)
async def live_plan_performance_endpoint(
    business_id: str,
    user=Depends(get_current_user),
) -> LivePlanPerformanceResponse:
    performance = await build_performance(user_id=user["id"], business_id=business_id)
    return LivePlanPerformanceResponse(business_id=business_id, performance=performance)


@router.get("/variances", response_model=LivePlanVarianceResponse)
async def live_plan_variances_endpoint(
    business_id: str,
    user=Depends(get_current_user),
) -> LivePlanVarianceResponse:
    variances = await list_variances(user_id=user["id"], business_id=business_id)
    return LivePlanVarianceResponse(business_id=business_id, variances=variances)


@router.get("/alerts", response_model=LivePlanAlertResponse)
async def live_plan_alerts_endpoint(
    business_id: str,
    user=Depends(get_current_user),
) -> LivePlanAlertResponse:
    alerts = await list_alerts(user_id=user["id"], business_id=business_id)
    return LivePlanAlertResponse(business_id=business_id, alerts=alerts)


@router.post("/alerts/{alert_id}/acknowledge")
async def live_plan_alert_acknowledge(
    business_id: str,
    alert_id: str,
    user=Depends(get_current_user),
) -> dict:
    alert = await acknowledge_alert(user_id=user["id"], business_id=business_id, alert_id=alert_id, dismissed=False)
    return {"business_id": business_id, "alert": alert}


@router.post("/alerts/{alert_id}/dismiss")
async def live_plan_alert_dismiss(
    business_id: str,
    alert_id: str,
    user=Depends(get_current_user),
) -> dict:
    alert = await acknowledge_alert(user_id=user["id"], business_id=business_id, alert_id=alert_id, dismissed=True)
    return {"business_id": business_id, "alert": alert}


@router.post("/scenarios/{scenario_id}/adopt", response_model=LivePlanResponse)
async def live_plan_adopt_scenario(
    business_id: str,
    scenario_id: str,
    payload: LivePlanScenarioAdoptRequest | None = None,
    user=Depends(get_current_user),
) -> LivePlanResponse:
    payload = payload or LivePlanScenarioAdoptRequest()
    async with credit_guard(user["id"], "live_plan_scenario_adopt", payload.idempotency_key):
        plan = await adopt_scenario(user_id=user["id"], business_id=business_id, scenario_id=scenario_id)
    return LivePlanResponse(business_id=business_id, plan=plan)


@router.post("/narrative/refresh")
async def live_plan_narrative_refresh(
    business_id: str,
    payload: LivePlanNarrativeRefreshRequest | None = None,
    user=Depends(get_current_user),
) -> dict:
    payload = payload or LivePlanNarrativeRefreshRequest()
    async with credit_guard(user["id"], "live_plan_full_refresh", payload.idempotency_key):
        return await refresh_narrative(user_id=user["id"], business_id=business_id, section=payload.section)
