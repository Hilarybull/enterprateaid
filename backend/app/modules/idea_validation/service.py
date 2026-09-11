from __future__ import annotations

import asyncio
import json
import logging
import re
from datetime import datetime, timezone
import asyncio
import logging
from typing import Any, Dict
from uuid import uuid4

from fastapi import HTTPException, status

from app.core.config import get_settings
from app.modules.idea_validation.calculations import (
    CapacityInputs as CapacityCalcInputs,
    ConcentrationInputs,
    FinancialInputs,
    MarketContextInputs,
    ProofInputs,
    ProofLevel,
    SalesCycleInputs,
    evaluate_viability_v3,
)
from app.modules.idea_validation.market_fit_service import build_fallback_market_fit, get_market_fit
from app.modules.idea_validation.schemas import FinancialInputsPayload, IdeaValidationPayload
from app.modules.idea_validation.idea_validation_engine import IdeaValidationInputs, ResearchSignals, evaluate_idea_validation_v3
from app.modules.idea_validation.market_research_service import (
    run_research_data,
    run_ai_narration,
    extract_research_signals,
    flatten_fields_from_payload,
    flatten_fields_from_v4_payload,
)
from app.shared.schemas.common import WorkspaceDocument
from app.core.supabase import sb_insert, sb_select, sb_update
from app.shared.llm.openai_client import get_user_plan_info, plan_uses_serp
from app.modules.idea_validation.market_research_service import _pick_llm_caller

logger = logging.getLogger(__name__)

_FREE_PLAN_KEYS = {"free_trial", "explorer", "expired", ""}
_LIFETIME_VALIDATION_LIMIT = 1


async def create_workspace(
    *,
    user_id: str,
    name: str,
    data: Dict[str, Any],
) -> str:
    now = datetime.now(timezone.utc)
    data = _augment_workspace_patch(data or {})
    existing = await sb_select(
        "workspaces",
        filters=[("user_id", "eq", user_id)],
        order="updated_at",
        desc=True,
        limit=1,
        single=True,
    )
    if existing:
        merged = dict(existing.get("data") or {})
        for k, v in (data or {}).items():
            if k == "financials" and isinstance(v, dict) and isinstance(merged.get("financials"), dict):
                merged[k] = {**merged[k], **v}
            else:
                merged[k] = v
        update = {"data": merged, "updated_at": now.isoformat()}
        if name and name.strip():
            update["name"] = name.strip()
        # Snapshot the pre-write state — this path also fully replaces
        # non-financials top-level keys and deserves the same safety net.
        await _snapshot_before_write(str(existing["id"]), existing.get("name") or name or "Unnamed", existing.get("data") or {})
        await sb_update(
            "workspaces",
            filters=[("id", "eq", existing["id"]), ("user_id", "eq", user_id)],
            payload=update,
        )
        return str(existing["id"])

    workspace_id = str(uuid4())
    doc = {
        "id": workspace_id,
        "user_id": user_id,
        "name": name,
        "data": data,
        "created_at": now.isoformat(),
        "updated_at": now.isoformat(),
    }
    await sb_insert("workspaces", doc)
    return workspace_id


async def get_user_workspace(*, user_id: str) -> WorkspaceDocument | None:
    doc = await sb_select(
        "workspaces",
        filters=[("user_id", "eq", user_id)],
        order="updated_at",
        desc=True,
        limit=1,
        single=True,
    )
    if not doc:
        return None
    return WorkspaceDocument(**doc)


async def list_user_workspaces(*, user_id: str) -> list[WorkspaceDocument]:
    docs = await sb_select(
        "workspaces",
        filters=[("user_id", "eq", user_id)],
        order="updated_at",
        desc=True,
    )
    return [WorkspaceDocument(**d) for d in (docs or [])]


async def _get_accessible_workspace(*, user_id: str, workspace_id: str) -> tuple[WorkspaceDocument, bool]:
    doc = await sb_select(
        "workspaces",
        filters=[("id", "eq", workspace_id)],
        single=True,
    )
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace not found")

    workspace = WorkspaceDocument(**doc)
    if workspace.user_id == user_id:
        return workspace, True

    membership = await sb_select(
        "workspace_members",
        filters=[("workspace_id", "eq", workspace_id), ("user_id", "eq", user_id)],
        single=True,
    )
    if not membership:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace not found")
    return workspace, False


async def get_workspace(*, user_id: str, workspace_id: str) -> WorkspaceDocument:
    workspace, _is_owner = await _get_accessible_workspace(user_id=user_id, workspace_id=workspace_id)
    return workspace


def _inputs_from_payload(payload: FinancialInputsPayload) -> FinancialInputs:
    return FinancialInputs(
        price_per_unit=float(payload.price_per_unit),
        units_per_month=float(payload.units_per_month),
        fixed_costs_monthly=float(payload.fixed_costs_monthly),
        variable_cost_per_unit=float(payload.variable_cost_per_unit),
        starting_cash=float(payload.starting_cash),
    )


def _inputs_from_idea_validation(payload: IdeaValidationPayload) -> tuple[FinancialInputs, int, int, CapacityCalcInputs | None]:
    price = float(payload.offer.price_per_unit)
    units = float(payload.demand.expected_units_per_month)
    fixed = float(payload.costs.fixed_costs_monthly) + float(payload.costs.founder_draw_monthly) + float(payload.costs.contractor_costs_monthly)
    variable = float(payload.costs.variable_cost_per_unit)
    cash = float(payload.cash.starting_cash) if payload.cash else 0.0

    fin = FinancialInputs(
        price_per_unit=price,
        units_per_month=units,
        fixed_costs_monthly=fixed,
        variable_cost_per_unit=variable,
        starting_cash=cash,
    )

    payment_terms_days = int(payload.demand.payment_terms_days)
    sales_cycle_days = int(payload.demand.sales_cycle_days)

    cap: CapacityCalcInputs | None = None
    if payload.capacity:
        cap = CapacityCalcInputs(
            demand_units_per_month=units,
            team_size=int(payload.capacity.team_size),
            capacity_units_per_person_per_month=float(payload.capacity.capacity_units_per_person_per_month),
        )

    return fin, payment_terms_days, sales_cycle_days, cap


def _extract_concise_keyword(text: str) -> str:
    """Extract a short, search-friendly keyword from potentially long user descriptions."""
    t = (text or "").strip()
    if not t:
        return ""
    lt = t.lower()
    # Strip common conversational openers
    for stop in [
        "i intend to create an ", "i intend to create a ",
        "i am building a ", "i am building an ",
        "i want to build a ", "i want to build an ",
        "we are building a ", "we are building an ",
        "it is a ", "it is an ", "a startup that ", "an app that ",
        "a platform that ", "a service that ",
    ]:
        if lt.startswith(stop):
            t = t[len(stop):]
            lt = t.lower()
            break
    # If still long (> 40 chars or > 5 words), truncate to first 5 words
    words = t.split()
    if len(words) > 5 or len(t) > 40:
        t = " ".join(words[:5])
    return t.strip()


def _market_fit_params_from_idea_validation(payload: IdeaValidationPayload) -> dict[str, Any] | None:
    ctx = payload.context
    raw_offering = (ctx.business_offering or ctx.business_name or "").strip() or (payload.offer.service_type or "").strip()
    keyword_base = _extract_concise_keyword(raw_offering)
    industry = (getattr(ctx, "primary_industry", "") or "").strip() or (ctx.business_type or "").strip()
    location = (ctx.location or "").strip() or "United Kingdom"
    if location.lower() == "national":
        location = "United Kingdom"
    uk_region = (getattr(ctx, "uk_region", "") or "").strip() or "GB-ENG"
    # Build clean keyword: concise concept + industry (if different)
    keyword = keyword_base
    if industry and industry.lower() not in keyword.lower():
        keyword = f"{keyword} {industry}".strip()
    if not keyword:
        return None
    return {"keyword": keyword, "industry": industry or "general", "location": location, "uk_region": uk_region}


async def _safe_market_fit(params: dict[str, Any], *, timeout_sec: float = 1.5) -> dict | None:
    try:
        return await asyncio.wait_for(get_market_fit(**params), timeout=timeout_sec)
    except asyncio.TimeoutError:
        return build_fallback_market_fit(**params, reason="timeout")
    except Exception:
        return build_fallback_market_fit(**params, reason="error")


async def check_user_usage(user_id: str, limit: int = 5) -> bool:
    """
    Check if the user has reached their daily validation limit.
    Returns True if allowed, False if limit reached.
    Gracefully allows the request if the usage table doesn't exist yet.
    """
    try:
        today = datetime.now(timezone.utc).date().isoformat()
        usage = await sb_select(
            "idea_validation_usage",
            filters=[("user_id", "eq", user_id), ("request_date", "eq", today)],
            single=True
        )

        if not usage:
            await sb_insert("idea_validation_usage", {
                "user_id": user_id,
                "request_date": today,
                "request_count": 1
            })
            return True

        count = usage.get("request_count", 0)
        if count >= limit:
            return False

        await sb_update(
            "idea_validation_usage",
            payload={"request_count": count + 1, "last_request_at": datetime.now(timezone.utc).isoformat()},
            filters=[("id", "eq", usage["id"])]
        )
        return True
    except Exception:
        # Table not yet migrated — allow the request rather than blocking all validations
        return True


async def save_validation_result(
    user_id: str,
    workspace_id: str | None,
    pathway: str,
    eval_result: dict,
    narrative_report: dict,
    fields: dict,
    market_fit: Optional[dict] = None,
    research_data: Optional[dict] = None
) -> str:
    """
    Persist a snapshot of the validation result to the database.
    """
    business_name = fields.get("business_name") or fields.get("business_idea_name") or "Concept"
    
    row = {
        "user_id": user_id,
        "workspace_id": workspace_id,
        "pathway": pathway,
        "business_name": business_name,
        "total_score": eval_result.get("score", eval_result.get("viability_score", 0)),
        "confidence_score": eval_result.get("confidence_score", 100),
        "scoring_details": eval_result.get("dimension_scores", eval_result.get("scoring_details", {})),
        "metrics": eval_result.get("metrics", {}),
        "report_narration": narrative_report.get("executive_summary") or str(narrative_report),
        "service_name": fields.get("service_name") or fields.get("business_idea_name") or fields.get("service_type"),
        "market_research": narrative_report,
        "market_fit": market_fit or eval_result.get("market_fit"),
        "research_data": research_data or eval_result.get("research_data"),
    }
    
    res = await sb_insert("idea_validation_results", row)
    return res[0]["id"] if res else ""


async def evaluate(
    *,
    user_id: str,
    workspace_id: str | None,
    inputs: FinancialInputsPayload | None,
    idea_validation: IdeaValidationPayload | None = None,
) -> dict:
    """
    Main evaluation entry point.
    Now follows the deterministic research-backed flow for idea validation.
    """
    # 1. Plan-based gating: enforce lifetime limits and route SerpAPI
    from app.modules.credits.service import _has_platform_grant
    plan_key, plan_status = await get_user_plan_info(user_id)
    _on_free_plan = plan_key in _FREE_PLAN_KEYS or plan_status in {"trial", "expired"}
    _has_grant = _on_free_plan and await _has_platform_grant(user_id, "full_access")
    is_free_plan = _on_free_plan and not _has_grant
    use_serp = plan_uses_serp(plan_key, plan_status) or _has_grant

    # Always prefer the user's current input payloads when provided.
    iv_payload = None
    if idea_validation:
        iv_payload = idea_validation
    elif workspace_id:
        ws = await get_workspace(user_id=user_id, workspace_id=workspace_id)
        ws_iv = ws.data.get("idea_validation") or ws.data.get("draft_idea_validation")
        if isinstance(ws_iv, dict):
            try:
                iv_payload = IdeaValidationPayload(**ws_iv)
            except Exception:
                iv_payload = None

    if iv_payload:
        # NEW FLOW: Research -> Scoring -> Narration
        # Defensive conversion for Pydantic v1/v2 compatibility
        payload_dict = iv_payload.model_dump() if hasattr(iv_payload, "model_dump") else iv_payload.dict()
        fields = flatten_fields_from_payload(payload_dict)
        
        # Sanitise "National" location to "United Kingdom"
        if getattr(iv_payload.context, 'location', '') == "National":
            iv_payload.context.location = "United Kingdom"
        if fields.get("location") == "National":
            fields["location"] = "United Kingdom"
        
        _prob = iv_payload.problem
        _val = iv_payload.validation

        # Map payload to engine inputs — guard all optional nested objects
        # USER REQUEST: Do not use Workspace/Business Name as the search term.
        # Use 'business_offering' for Business Idea, and 'service_type' for Product/Service Idea.
        if iv_payload.pathway == "business_idea":
            raw_name = iv_payload.context.business_offering or iv_payload.context.description or iv_payload.context.business_name or "Business Idea"
        else:
            raw_name = iv_payload.offer.service_type or iv_payload.context.business_name or "Product Service Idea"
        
        # Extract a clean, concise keyword for search queries and report title
        concise_name = _extract_concise_keyword(raw_name) or raw_name

        engine_inputs = IdeaValidationInputs(
            idea_name=concise_name,
            idea_description=raw_name,  # Keep full description for AI context
            target_customer=_prob.customer_segment if _prob else "",
            problem_description=_prob.problem_type if _prob else "",
            pain_level=(_prob.severity if _prob else "moderate") or "moderate",
            alternatives=(_prob.alternatives if _prob else "") or "",
            differentiation=iv_payload.offer.service_type or "",
            market_scope=iv_payload.context.location or "United Kingdom",
            evidence_signals=(_val.demand_proof if _val else []) or [],
            spoken_to_count=(_val.spoken_count if _val else "0") or "0",
            estimated_price=iv_payload.offer.price_per_unit or 0.0,
            expected_units_per_month=iv_payload.demand.expected_units_per_month or 0.0,
            variable_cost_per_unit=iv_payload.costs.variable_cost_per_unit or 0.0,
            fixed_costs_monthly=iv_payload.costs.fixed_costs_monthly or 0.0,
            currency=iv_payload.context.currency or "GBP"
        )
        
        # Override what_building in fields so AI prompt and search queries use the concise keyword
        fields["what_building"] = concise_name
        fields["business_name"] = concise_name
        fields["idea_description"] = raw_name  # AI uses full description for context

        # A. Research Retrieval
        logger.info(f"Starting research retrieval for idea: {engine_inputs.idea_name} (serp={use_serp})")
        try:
            research_res = await run_research_data(fields, use_serp=use_serp)
        except Exception as e:
            logger.error(f"Research retrieval failed: {e}")
            research_res = {"evidence": {}, "sources": {}, "shopping": [], "search_queries": {}}
        
        # B. Signal Extraction
        logger.info("Extracting research signals...")
        try:
            signals_dict = extract_research_signals(research_res["evidence"], research_res["sources"])
            research_signals = ResearchSignals(**signals_dict)
        except Exception as e:
            logger.error(f"Signal extraction failed: {e}")
            research_signals = ResearchSignals()
        
        # C. Market Fit Analysis (Google Trends, Sector Survival, Competition)
        logger.info("Retreiving deterministic market fit signals...")
        try:
            mf_params = _market_fit_params_from_idea_validation(iv_payload)
            if mf_params:
                market_fit_res = await get_market_fit(**mf_params)
            else:
                market_fit_res = build_fallback_market_fit(keyword=engine_inputs.idea_name, industry="general", location=engine_inputs.market_scope or "UK")
        except Exception as e:
            logger.error(f"Market fit analysis failed: {e}")
            market_fit_res = build_fallback_market_fit(keyword=engine_inputs.idea_name, industry="general", location=engine_inputs.market_scope or "UK")

        # D. Deterministic Scoring — merge real market fit signals into research signals
        logger.info("Calculating deterministic scores...")
        try:
            # 1. Prepare Market Context (Internal Signal + External Benchmarks)
            mf_demand = (market_fit_res.get("demand") or {}).get("score", 50)
            mf_trend = (market_fit_res.get("demand") or {}).get("score", 60)
            survival = (market_fit_res.get("sector") or {}).get("survival_ratio", 0.6)
            
            market_context = MarketContextInputs(
                demand_trend_index=(float(mf_trend) - 50) / 50.0, # Map 0-100 to -1.0 to +1.0
                sector_survival_indicator=float(survival),
            )

            # 2. Map Proof Level
            proof_val = ProofLevel.NONE
            spoken = str(iv_payload.validation.spoken_count if iv_payload.validation else "0").lower()
            if "20+" in spoken or "10-20" in spoken:
                proof_val = ProofLevel.INFORMAL_INTEREST
            
            # Boost proof level based on signals
            signals = iv_payload.validation.demand_proof if iv_payload.validation else []
            if any("contract" in s.lower() or "signed" in s.lower() for s in signals):
                proof_val = ProofLevel.SIGNED_CONTRACT
            elif any("paid" in s.lower() or "payment" in s.lower() for s in signals):
                proof_val = ProofLevel.PAID_PILOT
            elif any("pilot" in s.lower() for s in signals):
                proof_val = ProofLevel.PILOTS

            proof_inputs = ProofInputs(
                proof_level=proof_val,
                proof_count=len(signals)
            )

            # 3. Financial & Operational Inputs
            fin_inputs = FinancialInputs(
                price_per_unit=iv_payload.offer.price_per_unit or 0.0,
                units_per_month=iv_payload.demand.expected_units_per_month or 0.0,
                fixed_costs_monthly=iv_payload.costs.fixed_costs_monthly or 0.0,
                variable_cost_per_unit=iv_payload.costs.variable_cost_per_unit or 0.0,
                starting_cash=iv_payload.cash.starting_cash if iv_payload.cash else 0.0
            )

            cap_inputs = CapacityCalcInputs(
                demand_units_per_month=iv_payload.demand.expected_units_per_month or 1.0,
                team_size=iv_payload.capacity.team_size if iv_payload.capacity else 1,
                capacity_units_per_person_per_month=iv_payload.capacity.capacity_units_per_person_per_month if iv_payload.capacity else 100.0
            )

            sc_inputs = SalesCycleInputs(
                sales_cycle_days=iv_payload.demand.sales_cycle_days or 30,
                payment_terms_days=iv_payload.demand.payment_terms_days or 14
            )

            conc_inputs = ConcentrationInputs(
                top_client_share_pct=iv_payload.costs.top_client_share_pct or 0.0,
                client_count=iv_payload.demand.client_count or 0
            )

            # 4. Routing: Validation vs Feasibility
            if iv_payload:
                # NEW FLOW: Core Idea Validation (Standard Engine v3.0)
                logger.info("Using Idea Validation Engine (v3.0)...")
                eval_result = evaluate_idea_validation_v3(
                    inputs=engine_inputs,
                    research=ResearchSignals(
                        demand_score=float(mf_demand),
                        trend_score=float(mf_trend),
                        competitor_count=market_fit_res.get("competition", {}).get("competitor_count", 0)
                    )
                )
            else:
                # LEGACY FLOW: Full Feasibility Analysis
                logger.info("Using Feasibility Engine (v3)...")
                eval_result = evaluate_viability_v3(
                    inputs=fin_inputs,
                    capacity=cap_inputs,
                    proof=proof_inputs,
                    sales_cycle=sc_inputs,
                    concentration=conc_inputs,
                    market_context=market_context,
                    market_fit_score=int(mf_demand)
                )
        except Exception as e:
            logger.error(f"Deterministic scoring failed: {e}")
            eval_result = {
                "score": 50,
                "classification": "Fair",
                "reasons": [f"Scoring engine encountered an error: {str(e)}"],
                "recommendations": ["Review your inputs for consistency."],
                "dimension_scores": {},
                "metrics": {}
            }

        # E. Claude Narration
        logger.info("Generating AI narration...")
        try:
            narration_fields = {
                **fields, 
                "deterministic_evaluation": eval_result,
                "market_fit_analysis": market_fit_res # Pass market fit to Claude for better summary
            }
            narrative_report = await run_ai_narration(narration_fields, research_res["evidence"], research_res["shopping"], user_id=user_id)
            # CRITICAL: LOG THE RESPONSE FOR VERIFICATION
            logger.info("AI Narration Response: %s", json.dumps(narrative_report, indent=2))
        except Exception as e:
            logger.error(f"AI narration failed: {e}")
            narrative_report = {
                "executive_summary": "Our AI narration service is temporarily unavailable, but your deterministic scores are ready below.",
                "dimension_explanations": {}
            }
        
        # F. Final Result Assembly
        logger.info("Assembling final validation report...")
        final_result = {
            "score": eval_result["score"],
            "dimension_scores": {
                **eval_result["dimension_scores"],
                "market_demand": int(market_fit_res.get("dimension_scores", {}).get("market_demand", 50)),
                "market_trend": int(market_fit_res.get("dimension_scores", {}).get("market_trend", 50) if "market_trend" in market_fit_res.get("dimension_scores", {}) else market_fit_res.get("demand", {}).get("score", 50)),
                "competition_validation": int(eval_result["dimension_scores"].get("competition_validation", 60)),
            },
            "metrics": eval_result["metrics"],
            "reasons": eval_result["reasons"],
            "recommendations": eval_result["recommendations"],
            "classification": eval_result["classification"],
            "market_fit": market_fit_res,
            "research_data": research_res,
            "market_research": narrative_report,
            "pathway": iv_payload.pathway,
            "business_name": engine_inputs.idea_name,
            "service_name": engine_inputs.idea_name,
            # Pull executive summary from AI narration (the source of truth), not from the engine
            "validation_explanation": (
                narrative_report.get("executive_summary") or
                narrative_report.get("viability_score", {}).get("summary") or
                "Validation summary is being generated based on market signals and your inputs."
            ),
            "dimension_explanations": {
                **eval_result.get("dimension_explanations", {}),
                **narrative_report.get("dimension_explanations", {}),
                **market_fit_res.get("dimension_explanations", {}),
            },
            "reason_codes": eval_result.get("reason_codes", []),
            "advisory_flags": eval_result.get("advisory_flags", []),
            "flags": eval_result.get("flags", []),
            "rubric_version": eval_result.get("rubric_version", "v0.3"),
        }
        
        # F. Persist to History
        try:
            result_id = await save_validation_result(
                user_id=user_id,
                workspace_id=workspace_id,
                pathway=iv_payload.pathway,
                eval_result=eval_result,
                narrative_report=narrative_report,
                fields=fields,
                market_fit=market_fit_res,
                research_data=research_res
            )
        except Exception as e:
            logger.exception("Failed to persist validation result")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Validation completed but could not be saved. Please try again.",
            ) from e

        final_result["result_id"] = result_id

        # G. Sync with Workspace for immediate UI hydration on refresh
        # We clear "decision" to ensure a fresh validation starts as 'PENDING'.
        if workspace_id:
            try:
                await update_workspace(
                    user_id=user_id,
                    workspace_id=workspace_id,
                    data_patch={
                        "idea_validation_result": final_result,
                        "decision": None
                    }
                )
            except Exception as e:
                logger.warning("Workspace sync failed after validation save: %s", e)

        logger.info(f"Validation result saved and workspace synced: {result_id}")
        
        return final_result

    # Fallback to legacy behavior if no idea validation structure is found
    if inputs is not None:
        return evaluate_viability_v3(_inputs_from_payload(inputs))

    if workspace_id:
        ws = await get_workspace(user_id=user_id, workspace_id=workspace_id)
        ws_inputs = ws.data.get("assumptions", ws.data.get("inputs"))
        if isinstance(ws_inputs, dict):
            try:
                inputs_payload = FinancialInputsPayload(**ws_inputs)
                return evaluate_viability_v3(_inputs_from_payload(inputs_payload))
            except Exception:
                pass
    
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Could not determine evaluation path")


def _build_v4_reasons(narrative_report: dict, v4_result: dict) -> list[str]:
    """Build Critical Risks list from AI narration risks + V4 risk flags."""
    ai_risks = [r for r in (narrative_report.get("risks") or []) if isinstance(r, str) and r.strip()]
    if ai_risks:
        return ai_risks
    # V4 risk_flags are dicts: {"dimension": str, "severity": str, "note": str}
    out = []
    for f in (v4_result.get("risk_flags") or []):
        if isinstance(f, str) and f.strip():
            out.append(f)
        elif isinstance(f, dict):
            note = (f.get("note") or "").strip()
            if note:
                out.append(note)
    return out


def _build_v4_recommendations(narrative_report: dict, v4_result: dict) -> list[str]:
    """Build Strategic Roadmap list from AI narration next_actions."""
    next_actions = narrative_report.get("next_actions") or []
    ai_recs = []
    for a in next_actions:
        if not isinstance(a, dict):
            continue
        action = (a.get("action") or "").strip()
        timeframe = (a.get("timeframe") or "").strip()
        if action:
            ai_recs.append(f"{action} ({timeframe})" if timeframe else action)
    if ai_recs:
        return ai_recs
    return [e.get("name", "") for e in (v4_result.get("experiments") or [])[:3] if e.get("name")]


async def _ai_enrich_v4_input(inp, user_id: str, call_llm=None) -> None:
    """
    Fill in blank VPS-scoring fields with AI inference so Basic-mode results
    reflect the idea rather than showing 0% for every unfilled step.
    Modifies inp in-place. ECS stays low since these are AI estimates, not
    user-provided evidence.
    """
    from app.modules.idea_validation.engine_v4 import V4Input

    # Only enrich fields that are genuinely empty
    needs_customer = not inp.primary_segment.strip()
    needs_solution = not inp.solution_description.strip()
    needs_revenue  = not inp.revenue_model.strip()

    if not (needs_customer or needs_solution or needs_revenue):
        return  # nothing to do

    # Build a compact context string from what the user did supply
    context_parts = [f"Idea: {inp.idea_name}" if inp.idea_name else ""]
    if inp.idea_type:
        context_parts.append(f"Type: {inp.idea_type}")
    if inp.idea_sector:
        context_parts.append(f"Sector: {inp.idea_sector}")
    if inp.idea_description:
        context_parts.append(f"Description: {inp.idea_description}")
    if inp.idea_tagline:
        context_parts.append(f"Tagline: {inp.idea_tagline}")
    if inp.problem_description:
        context_parts.append(f"Problem: {inp.problem_description}")
    if inp.who_affected:
        context_parts.append(f"Who is affected: {inp.who_affected}")
    if inp.customer_model:
        context_parts.append(f"Customer model: {inp.customer_model}")
    if inp.operating_country:
        context_parts.append(f"Country: {inp.operating_country}")

    context = "\n".join(p for p in context_parts if p)
    if not context.strip():
        return  # nothing to infer from

    fields_needed = []
    if needs_customer:
        fields_needed.append('"primary_segment": "<who the primary customer is, 1 short phrase>"')
        fields_needed.append('"customer_specificity": "<one of: broad, moderate, narrow, niche>"')
        fields_needed.append('"beachhead_segment": "<the most focused initial customer group, 1 phrase>"')
    if needs_solution:
        fields_needed.append('"solution_description": "<what the product/service does, 1-2 sentences>"')
        fields_needed.append('"core_outcome": "<the main result the customer achieves, 1 short phrase>"')
        fields_needed.append('"delivery_method": "<how it is delivered, e.g. online platform, mobile app, in-person>"')
    if needs_revenue:
        fields_needed.append('"revenue_model": "<most likely model, e.g. subscription, one-time, per-session>"')

    joined = ",\n  ".join(fields_needed)
    prompt = f"""You are a business analyst inferring missing business details from limited idea information.

{context}

Based only on the above, infer the most likely values for these fields. Be concise and realistic.
Return ONLY a valid JSON object with these exact keys — no explanation, no markdown:
{{{joined}}}"""

    try:
        if call_llm is None:
            call_llm = await _pick_llm_caller(user_id)
        raw = await call_llm(prompt, user_id=user_id, feature="idea_validation.v4_enrichment", max_tokens=512)
        if not raw:
            return
        text = raw if isinstance(raw, str) else (raw.get("executive_summary") or raw.get("raw") or json.dumps(raw))
        # Extract JSON
        start = text.find("{")
        end = text.rfind("}") + 1
        if start == -1 or end == 0:
            return
        inferred = json.loads(text[start:end])
        if not isinstance(inferred, dict):
            return

        def _clean(v: str) -> str:
            return v.replace("—", " ").replace("–", " to ").strip()

        # Apply inferred values only to fields that were empty
        if needs_customer:
            if inferred.get("primary_segment"):
                inp.primary_segment = _clean(str(inferred["primary_segment"]))
            if inferred.get("customer_specificity") and inferred["customer_specificity"].lower() in ("broad", "moderate", "narrow", "niche"):
                inp.customer_specificity = inferred["customer_specificity"].lower()
            if inferred.get("beachhead_segment"):
                inp.beachhead_segment = _clean(str(inferred["beachhead_segment"]))
        if needs_solution:
            if inferred.get("solution_description"):
                inp.solution_description = _clean(str(inferred["solution_description"]))
            if inferred.get("core_outcome"):
                inp.core_outcome = _clean(str(inferred["core_outcome"]))
            if inferred.get("delivery_method"):
                inp.delivery_method = _clean(str(inferred["delivery_method"]))
        if needs_revenue:
            if inferred.get("revenue_model"):
                inp.revenue_model = _clean(str(inferred["revenue_model"]))

    except Exception as exc:
        logger.warning("V4 AI enrichment failed (non-fatal): %s", exc)


async def _ai_generate_experiments(v4_inp, vps_dims: list[dict], user_id: str, call_llm=None) -> list[dict]:
    """Generate adaptive validation experiments via LLM, tailored to the specific idea and weak dimensions."""
    from app.modules.idea_validation.engine_v4 import generate_experiments

    weak_dims = sorted(vps_dims, key=lambda d: d.get("pct", 0))[:5]
    weak_dim_lines = "\n".join(
        f"  - {d['dimension']} ({d.get('pct', 0):.0f}%): {d.get('label', '')}" for d in weak_dims
    )

    evidence_list = ", ".join(v4_inp.evidence_types) if v4_inp.evidence_types else "none documented"
    channels_list = ", ".join(v4_inp.channels) if v4_inp.channels else "not specified"

    context_parts = [
        f"Idea: {v4_inp.idea_name or 'Unnamed'}",
        f"Description: {v4_inp.idea_description or v4_inp.idea_tagline or 'Not provided'}",
        f"Type: {v4_inp.idea_type or 'Not specified'} | Sector: {v4_inp.idea_sector or 'Not specified'}",
        f"Stage: {v4_inp.business_stage or 'idea'} | Customer model: {v4_inp.customer_model or 'Not specified'}",
        f"Primary customer: {v4_inp.primary_segment or 'Not specified'}",
        f"Problem: {v4_inp.problem_description or 'Not provided'}",
        f"Solution: {v4_inp.solution_description or 'Not provided'}",
        f"Delivery method: {v4_inp.delivery_method or 'Not specified'}",
        f"Revenue model: {v4_inp.revenue_model or 'Not specified'}",
        f"Proposed price: {v4_inp.proposed_price or 'Not specified'}",
        f"Customer channels: {channels_list}",
        f"Existing evidence: {evidence_list}",
    ]
    context = "\n".join(context_parts)

    joined_keys = ",\n    ".join([
        '"name"', '"method"', '"duration"', '"hypothesis"', '"why_it_matters"',
        '"target_customer"', '"sample_size"', '"budget"', '"metric"',
        '"evidence_to_collect"', '"pass_threshold"', '"partial_pass_threshold"',
        '"fail_threshold"', '"if_passed"', '"if_failed"'
    ])

    prompt = f"""You are a lean startup validation expert designing hypothesis-driven experiments.

IDEA CONTEXT:
{context}

WEAKEST VALIDATION DIMENSIONS (prioritise addressing these):
{weak_dim_lines}

Generate 3 to 5 validation experiments tailored specifically to this idea and its weakest dimensions. Each must be concrete, actionable, and realistic for a founder at the {v4_inp.business_stage or 'idea'} stage with limited resources.

Return ONLY a valid JSON array. Each element must have exactly these keys:
[
  {{
    {joined_keys}
  }}
]

Rules:
- Name experiments specifically to this idea (e.g. "Catering Pre-Order Campaign" not "Sales Test")
- Write the hypothesis in first person about this specific product/customer
- Budget and timeline must be realistic for the stage
- Pass/fail thresholds must be concrete numbers or percentages
- evidence_to_collect must name specific data points to gather
- if_passed and if_failed must name the concrete next step
- Do not add markdown, explanation, or any text outside the JSON array"""

    try:
        if call_llm is None:
            call_llm = await _pick_llm_caller(user_id)
        raw = await call_llm(prompt, user_id=user_id, feature="idea_validation.v4_enrichment", max_tokens=2048)
        text = raw if isinstance(raw, str) else (raw.get("executive_summary") or raw.get("raw") or json.dumps(raw))
        text = text.strip()
        # Strip markdown code fences if present
        if text.startswith("```"):
            text = text.split("```", 2)[1]
            if text.startswith("json"):
                text = text[4:]
            text = text.rsplit("```", 1)[0].strip()
        experiments = json.loads(text)
        if isinstance(experiments, list) and experiments:
            return experiments
    except Exception as exc:
        logger.warning("AI experiment generation failed (falling back to static): %s", exc)

    return generate_experiments(v4_inp, vps_dims)


def _compute_comprehensive_metrics(payload: dict, v4_inp: Any) -> dict:
    """Deterministically compute unit economics, 12-month forecast, and evidence metrics from wizard inputs."""
    step7 = payload.get("step7") or {}
    step8 = payload.get("step8") or {}
    step9 = payload.get("step9") or {}
    step10 = payload.get("step10") or {}
    step11 = payload.get("step11") or {}
    step12 = payload.get("step12") or {}
    currency = str(payload.get("currency") or "GBP")

    def _parse_num(s: Any) -> float | None:
        if s is None:
            return None
        # Extract only the FIRST numeric token from free text, e.g.:
        #   "$4,000/month (2 founders' salaries)" → 4000  (not 40002)
        #   "£49.99"                              → 49.99
        #   "0.7" or "70%"                        → 0.7 / 70
        m = re.search(r"\d+(?:,\d{3})*(?:\.\d+)?", str(s))
        if not m:
            return None
        try:
            return float(m.group().replace(",", ""))
        except ValueError:
            return None

    price = _parse_num(step7.get("proposed_price") or getattr(v4_inp, "proposed_price", None))
    variable_cost = _parse_num(step8.get("variable_cost_per_unit")) if step8.get("variable_cost_known") else None
    fixed_costs = _parse_num(step8.get("fixed_costs_monthly"))
    capacity = _parse_num(step9.get("capacity_per_month"))

    # Gross margin — accept 0.7 (fraction) or 70 (percentage)
    gross_margin_pct: float | None = None
    gm_raw = _parse_num(step8.get("gross_margin_estimate"))
    if gm_raw is not None:
        gross_margin_pct = round(gm_raw * 100, 1) if gm_raw <= 1.0 else round(gm_raw, 1)

    # Contribution per unit
    contribution: float | None = None
    if price is not None and variable_cost is not None:
        contribution = round(price - variable_cost, 2)
        if gross_margin_pct is None and price > 0:
            gross_margin_pct = round((contribution / price) * 100, 1)
    elif price is not None and gross_margin_pct is not None:
        contribution = round(price * gross_margin_pct / 100, 2)

    # Break-even
    breakeven_units: float | None = None
    breakeven_months: float | None = None
    if contribution and contribution > 0 and fixed_costs is not None:
        breakeven_units = round(fixed_costs / contribution, 1)
        if capacity and capacity > 0:
            breakeven_months = round(breakeven_units / capacity, 1)

    # 12-month forecast with progressive capacity ramp
    monthly_forecast = None
    if price is not None and capacity is not None and capacity > 0:
        ramps = [0.10, 0.15, 0.20, 0.30, 0.40, 0.50, 0.60, 0.65, 0.70, 0.75, 0.85, 1.00]
        monthly_forecast = []
        for i, r in enumerate(ramps):
            units = round(capacity * r)
            revenue = round(units * price, 2)
            cogs = round(units * (variable_cost or 0), 2)
            gross_profit = round(revenue - cogs, 2)
            net = round(gross_profit - (fixed_costs or 0), 2)
            monthly_forecast.append({
                "month": i + 1,
                "capacity_pct": int(r * 100),
                "units": units,
                "revenue": revenue,
                "gross_profit": gross_profit,
                "net_income": net,
            })

    # Evidence strength breakdown
    EVIDENCE_LABELS: dict[str, tuple[str, str]] = {
        "no_evidence": ("No evidence", "none"),
        "personal_experience": ("Personal experience", "weak"),
        "informal_conversations": ("Informal conversations", "weak"),
        "customer_interviews": ("Customer interviews", "moderate"),
        "survey_responses": ("Survey responses", "moderate"),
        "social_media_engagement": ("Social media engagement", "moderate"),
        "search_demand": ("Search demand data", "moderate"),
        "landing_page_visits": ("Landing page visits", "moderate"),
        "email_sign_ups": ("Email sign-ups", "moderate"),
        "waiting_list": ("Waiting list", "strong"),
        "letters_of_intent": ("Letters of intent", "strong"),
        "requests_for_quotation": ("Requests for quotation", "strong"),
        "pre_orders": ("Pre-orders", "strong"),
        "deposits": ("Deposits received", "strong"),
        "paid_pilots": ("Paid pilots", "strong"),
        "existing_customers": ("Existing customers", "verified"),
        "repeat_customers": ("Repeat customers", "verified"),
        "revenue": ("Revenue generated", "verified"),
        "retention_data": ("Retention data", "verified"),
        "usage_data": ("Usage data", "verified"),
    }
    evidence_types = step10.get("evidence_types") or []
    evidence_breakdown = [
        {
            "type": et,
            "label": EVIDENCE_LABELS.get(et, (str(et).replace("_", " ").title(), "unknown"))[0],
            "strength": EVIDENCE_LABELS.get(et, ("", "unknown"))[1],
        }
        for et in evidence_types
    ]

    # Founder profile
    exp = str(step11.get("founder_industry_experience") or "none")
    capital = bool(step11.get("founder_capital_available"))
    time_av = bool(step11.get("founder_time_available"))
    if capital and time_av:
        fit_note = "Capital and time are both available — self-funded, full-commitment launch is viable."
    elif capital and not time_av:
        fit_note = "Capital is available but time is limited — consider a co-founder or fractional model."
    elif not capital and time_av:
        fit_note = "Time is available but capital is limited — prioritise lean validation and explore grant or accelerator funding."
    else:
        fit_note = "Both capital and time are constrained — a side-project approach or external funding will be needed before full commitment."

    return {
        "unit_economics": {
            "currency": currency,
            "price_per_unit": price,
            "variable_cost_per_unit": variable_cost,
            "contribution_per_unit": contribution,
            "gross_margin_pct": gross_margin_pct,
            "fixed_costs_monthly": fixed_costs,
            "breakeven_units": breakeven_units,
            "breakeven_months": breakeven_months,
            "capacity_per_month": capacity,
        },
        "monthly_forecast": monthly_forecast,
        "evidence_breakdown": evidence_breakdown,
        "founder_profile": {
            "experience_level": exp,
            "capital_available": capital,
            "time_available": time_av,
            "fit_note": fit_note,
        },
        "regulatory_summary": {
            "risk_level": str(step12.get("regulatory_risk_level") or "unknown"),
            "requirements_known": bool(step12.get("regulatory_requirements_known")),
            "mitigation_planned": bool(step12.get("regulatory_mitigation_planned")),
        },
    }


async def evaluate_v4_idea(*, user_id: str, payload: dict) -> dict:
    """
    V4 Universal Validation — deterministic scoring (VPS + ECS) + live web research.
    Accepts the raw V4 wizard payload {step1..step12, validation_mode, currency, workspace_id}.
    """
    from app.modules.idea_validation.engine_v4 import v4_payload_to_input, evaluate_v4

    # 1. Plan gating — platform grants (Privileged) count as paid regardless of plan key
    from app.modules.credits.service import _has_platform_grant
    plan_key, plan_status = await get_user_plan_info(user_id)
    _on_free_plan = plan_key in _FREE_PLAN_KEYS or plan_status in {"trial", "expired"}
    has_grant = _on_free_plan and await _has_platform_grant(user_id, "full_access")
    is_free = _on_free_plan and not has_grant
    use_serp = plan_uses_serp(plan_key, plan_status) or has_grant

    # Resolve LLM caller ONCE — each call to _pick_llm_caller hits Supabase twice
    call_llm = await _pick_llm_caller(user_id)

    # 2. Deterministic scoring — enrich blank fields with AI before scoring
    v4_inp = v4_payload_to_input(payload)
    await _ai_enrich_v4_input(v4_inp, user_id, call_llm=call_llm)
    v4_result = evaluate_v4(v4_inp)

    # 3. Flatten V4 fields for search query building (fast, must run before research)
    fields = flatten_fields_from_v4_payload(payload)
    vps_dims = v4_result["scores"].get("vps_dimensions", [])

    # 2b + 4. Run experiments generation and web research in parallel
    logger.info("V4: starting experiments + web research in parallel (serp=%s)", use_serp)

    async def _run_research():
        try:
            return await run_research_data(fields, use_serp=use_serp)
        except Exception as exc:
            logger.error("V4 research retrieval failed: %s", exc)
            return {"evidence": {}, "sources": {}, "shopping": [], "search_queries": {}}

    ai_experiments, research_res = await asyncio.gather(
        _ai_generate_experiments(v4_inp, vps_dims, user_id, call_llm=call_llm),
        _run_research(),
    )

    # 5. AI narration — pass V4 scores in the format the synthesis prompt understands
    vps = v4_result["scores"]["potential_score"]
    ecs = v4_result["scores"]["evidence_confidence_score"]
    verdict = v4_result["verdict"]

    # 5b. Compute deterministic metrics BEFORE narration so the AI can cite exact figures
    comp_metrics: dict | None = None
    if payload.get("validation_mode") == "comprehensive" and not is_free:
        try:
            comp_metrics = _compute_comprehensive_metrics(payload, v4_inp)
        except Exception as _cm_err:
            logger.error("comprehensive metrics computation failed: %s", _cm_err)

    narration_fields = {
        **fields,
        "deterministic_evaluation": {
            "score": vps,
            "classification": verdict.get("label", verdict.get("category", "")),
        },
        **({"computed_metrics": comp_metrics} if comp_metrics else {}),
    }
    # Basic validation uses fewer tokens per LLM call to stay well within time limits.
    # 3500 per call ensures JSON completes cleanly (2500 was truncating mid-JSON).
    narration_max_tokens = 6000 if payload.get("validation_mode") == "comprehensive" else 4500
    try:
        narrative_report = await run_ai_narration(
            narration_fields,
            research_res["evidence"],
            research_res.get("shopping", []),
            user_id=user_id,
            sources=research_res.get("sources", {}),
            max_tokens=narration_max_tokens,
            call_llm=call_llm,
        )
        logger.info("V4 narration complete.")
    except Exception as exc:
        logger.error("V4 narration failed: %s", exc)
        narrative_report = {
            "executive_summary": "Validation complete. Scores are ready below.",
            "dimension_explanations": {},
        }

    # 6. Map VPS dimensions → dimension_scores for ResultsPage radar/bar charts
    dimension_scores: dict[str, int] = {}
    for dim in (v4_result["scores"].get("vps_dimensions") or []):
        key = dim.get("dimension", "")
        if key:
            dimension_scores[key] = int(dim.get("pct", 0))

    classification = verdict.get("label", verdict.get("category", "Developing Fit")).upper()

    final_result = {
        # V4-native fields
        "engine_version": "4.0",
        "validation_mode": "basic" if is_free else payload.get("validation_mode", "basic"),
        "is_paid_plan": not is_free,
        "idea_name": v4_inp.idea_name or fields.get("business_name", ""),
        "idea_type": v4_inp.idea_type or "",
        "idea_sector": v4_inp.idea_sector or "",
        "idea_tagline": v4_inp.idea_tagline or "",
        "idea_description": v4_inp.idea_description or "",
        "primary_segment": v4_inp.primary_segment or "",
        "problem_description": v4_inp.problem_description or "",
        "solution_description": v4_inp.solution_description or "",
        "proposed_price": v4_inp.proposed_price or "",
        "revenue_model": v4_inp.revenue_model or "",
        "scores": v4_result["scores"],
        "summary": v4_result.get("summary", {}),
        "verdict": verdict,
        "experiments": ai_experiments,
        "contradictions": v4_result.get("contradictions", []),
        "risk_flags": v4_result.get("risk_flags", []),
        # ResultsPage-compatible fields
        "score": vps,
        "classification": classification,
        "dimension_scores": dimension_scores,
        "market_research": narrative_report,
        "research_data": research_res,
        "validation_explanation": narrative_report.get("executive_summary", ""),
        "dimension_explanations": {
            **narrative_report.get("dimension_explanations", {}),
        },
        "business_name": v4_inp.idea_name or fields.get("business_name", ""),
        "service_name": v4_inp.idea_name or fields.get("business_name", ""),
        "pathway": "v4_universal",
        "reasons": _build_v4_reasons(narrative_report, v4_result),
        "recommendations": _build_v4_recommendations(narrative_report, v4_result),
        "flags": [],
        "advisory_flags": [],
    }

    # 6b. Attach pre-computed comprehensive metrics (computed in step 5b, before narration)
    if comp_metrics is not None:
        final_result["comprehensive_metrics"] = comp_metrics

    # 7. Persist result
    workspace_id = payload.get("workspace_id")
    try:
        result_id = await save_validation_result(
            user_id=user_id,
            workspace_id=workspace_id,
            pathway="v4_universal",
            eval_result={
                "score": vps,
                "dimension_scores": dimension_scores,
                "metrics": {},
                "reasons": final_result["reasons"],
                "recommendations": final_result["recommendations"],
                "classification": classification,
                "dimension_explanations": {},
            },
            narrative_report=narrative_report,
            fields=fields,
            research_data=research_res,
        )
        final_result["result_id"] = result_id
    except Exception as exc:
        # Persist failure must not block the user from seeing their result.
        # Log the issue for ops but return the completed validation anyway.
        logger.error("V4 result persist failed (non-fatal): %s", exc)

    return final_result


async def market_fit(
    *,
    keyword: str,
    industry: str,
    location: str,
    uk_region: str = "GB-ENG",
    sic_code: str | None = None,
    radius_metres: int = 5000,
) -> dict:
    _ = get_settings()
    params = {
        "keyword": keyword,
        "industry": industry,
        "location": location,
        "uk_region": uk_region,
        "sic_code": sic_code,
        "radius_metres": radius_metres,
    }
    try:
        return await asyncio.wait_for(get_market_fit(**params), timeout=6.0)
    except asyncio.TimeoutError:
        return build_fallback_market_fit(**params, reason="timeout")
    except Exception:
        return build_fallback_market_fit(**params, reason="error")


MAX_SNAPSHOTS = 50
SNAPSHOT_INTERVAL_MINUTES = 15
SNAPSHOT_TIMEOUT_SECONDS = 4.0


async def _save_snapshot_to_mongo(workspace_id: str, workspace_name: str, data: Dict[str, Any], now_iso: str) -> bool:
    """Persist a pre-write copy of a workspace's data. Returns True if written,
    False if rate-limited or failed. Never raises — but DOES log failures so a
    misconfigured / unreachable Mongo is visible instead of silent."""
    try:
        from app.core.database import get_mongo_db
        db = get_mongo_db()
        col = db["workspace_snapshots"]

        # Rate-limit: skip if a snapshot already exists within the interval window
        latest = await col.find_one(
            {"workspace_id": workspace_id},
            sort=[("created_at", -1)],
            projection={"created_at": 1},
        )
        if latest and latest.get("created_at"):
            try:
                last_dt = datetime.fromisoformat(str(latest["created_at"]).replace("Z", "+00:00"))
                now_dt = datetime.fromisoformat(now_iso.replace("Z", "+00:00"))
                if (now_dt - last_dt).total_seconds() < SNAPSHOT_INTERVAL_MINUTES * 60:
                    return False
            except Exception:
                pass

        await col.insert_one({
            "workspace_id": workspace_id,
            "workspace_name": workspace_name,
            "data": data,
            "created_at": now_iso,
        })
        # Keep only the most recent MAX_SNAPSHOTS per workspace
        oldest_ids = await col.find(
            {"workspace_id": workspace_id},
            {"_id": 1},
        ).sort("created_at", -1).skip(MAX_SNAPSHOTS).to_list(length=None)
        if oldest_ids:
            await col.delete_many({"_id": {"$in": [d["_id"] for d in oldest_ids]}})
        return True
    except Exception as exc:  # never break the save path — but do not hide it
        logging.getLogger(__name__).warning(
            "workspace snapshot FAILED for %s: %s: %s",
            workspace_id, type(exc).__name__, exc,
        )
        return False


async def _snapshot_before_write(workspace_id: str, workspace_name: str, data: Dict[str, Any]) -> None:
    """Capture the current (pre-write) workspace state, AWAITED and time-bounded.

    Previously this was scheduled with asyncio.create_task() and never awaited —
    on the hosting platform the request returns and the orphan task is dropped
    before it runs, which is why ~one snapshot was ever written. It is now
    awaited inline with a hard timeout so a slow/unreachable Mongo can delay a
    save by at most SNAPSHOT_TIMEOUT_SECONDS, never lose the snapshot.
    """
    now_iso = datetime.now(timezone.utc).isoformat()
    try:
        await asyncio.wait_for(
            _save_snapshot_to_mongo(workspace_id, workspace_name, dict(data or {}), now_iso),
            timeout=SNAPSHOT_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError:
        logging.getLogger(__name__).warning(
            "workspace snapshot timed out (%ss) for %s", SNAPSHOT_TIMEOUT_SECONDS, workspace_id
        )
    except Exception as exc:
        logging.getLogger(__name__).warning("workspace snapshot error for %s: %s", workspace_id, exc)


async def update_workspace(
    *,
    user_id: str,
    workspace_id: str,
    data_patch: Dict[str, Any],
    name: str | None = None,
) -> WorkspaceDocument:
    ws, _is_owner = await _get_accessible_workspace(user_id=user_id, workspace_id=workspace_id)
    now = datetime.now(timezone.utc)

    logger = logging.getLogger(__name__)
    logger.info("update_workspace start: workspace_id=%s user_id=%s", workspace_id, user_id)

    merged = dict(ws.data or {})
    data_patch = _augment_workspace_patch(data_patch or {}, existing=merged)
    for k, v in (data_patch or {}).items():
        # Deep-merge financials so keys written by other endpoints (e.g. rfq_requests)
        # are never wiped by a frontend patch that doesn't include them.
        if k == "financials" and isinstance(v, dict) and isinstance(merged.get("financials"), dict):
            merged[k] = {**merged[k], **v}
        else:
            merged[k] = v

    ws_name = (name and str(name).strip()) or ws.name or "Unnamed"

    # Snapshot the CURRENT (pre-write) state to MongoDB before we overwrite it.
    # Awaited + time-bounded (see _snapshot_before_write) — the old fire-and-forget
    # task was being dropped, so this safety net had effectively never worked.
    await _snapshot_before_write(str(ws.id), ws_name, ws.data or {})

    update = {"data": merged, "updated_at": now.isoformat()}
    if name and str(name).strip():
        update["name"] = str(name).strip()

    try:
        logger.info("calling sb_update for workspace %s", workspace_id)
        await sb_update(
            "workspaces",
            filters=[("id", "eq", ws.id), ("user_id", "eq", ws.user_id)],
            payload=update,
        )
        logger.info("sb_update completed for workspace %s", workspace_id)
    except Exception as e:
        logger.exception("sb_update failed for workspace %s: %s", workspace_id, e)
        raise
    return await get_workspace(user_id=user_id, workspace_id=workspace_id)


async def upsert_user_workspace(
    *,
    user_id: str,
    data_patch: Dict[str, Any],
    name: str | None = None,
) -> WorkspaceDocument:
    data_patch = _augment_workspace_patch(data_patch or {})
    existing = await get_user_workspace(user_id=user_id)
    if existing:
        return await update_workspace(
            user_id=user_id,
            workspace_id=str(existing.id),
            data_patch=data_patch,
            name=name,
        )

    default_name = str(name).strip() if name and str(name).strip() else "My workspace"
    workspace_id = await create_workspace(user_id=user_id, name=default_name, data=data_patch or {})
    return await get_workspace(user_id=user_id, workspace_id=workspace_id)


def _augment_workspace_patch(data_patch: Dict[str, Any], *, existing: Dict[str, Any] | None = None) -> Dict[str, Any]:
    # Validation details must never overwrite workspace/business profile details.
    # The workspace profile is set independently via the workspace creation/editing flow.
    return dict(data_patch or {})


def _derive_business_profile_from_idea_validation(iv: Dict[str, Any]) -> Dict[str, Any]:
    ctx = iv.get("context") if isinstance(iv.get("context"), dict) else {}
    prob = iv.get("problem") if isinstance(iv.get("problem"), dict) else {}
    offer = iv.get("offer") if isinstance(iv.get("offer"), dict) else {}

    return {
        "business_name": str(ctx.get("business_name") or "").strip() or None,
        "business_type": str(ctx.get("business_type") or "").strip() or None,
        "primary_industry": str(ctx.get("primary_industry") or "").strip() or None,
        "location": str(ctx.get("location") or "").strip() or None,
        "currency": str(ctx.get("currency") or "").strip() or None,
        "target_market": str(prob.get("customer_segment") or "").strip() or None,
        "problem": str(prob.get("problem_type") or "").strip() or None,
        "solution": str(offer.get("service_type") or "").strip() or None,
        "pricing_model": str(offer.get("pricing_model") or "").strip() or None,
    }


def _market_fit_params_from_idea_validation(payload: IdeaValidationPayload) -> dict:
    ctx = payload.context
    prob = payload.problem
    offer = payload.offer
    
    # USER REQUEST: Prioritize specific idea name/offering over general business/workspace name.
    offering = str(ctx.business_offering or "").strip()
    service_type = str(offer.service_type or "").strip()
    problem_type = str(prob.problem_type or "").strip()
    business_name = str(ctx.business_name or "").strip()
    
    keyword = offering or service_type or problem_type or business_name or "new business idea"
    industry = str(ctx.primary_industry or ctx.business_type or "general").strip()
    
    location = str(ctx.location or "United Kingdom").strip()
    if location == "National":
        location = "United Kingdom"
        
    uk_region = str(ctx.uk_region or "GB-ENG").strip()
    
    return {
        "keyword": keyword,
        "industry": industry,
        "location": location,
        "uk_region": uk_region,
    }
