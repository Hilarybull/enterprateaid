from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Literal, Optional
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

from app.core.config import get_settings
from app.core.supabase import sb_select, sb_upsert, sb_update
from app.modules.credits.service import normalise_plan_key
from app.shared.auth.deps import get_current_user
from app.shared.auth.security import create_access_token, decode_token
from app.modules.idea_validation.service import get_user_workspace, upsert_user_workspace
from app.modules.integrations import quickbooks as qb
from app.modules.integrations import xero as xero_mod
from app.modules.integrations import zoho as zoho_mod
from app.modules.integrations import stripe as stripe_mod
from app.shared.currency import get_rate, convert as convert_amount

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/integrations", tags=["integrations"])

Provider = Literal["quickbooks", "xero", "zoho_crm", "stripe"]
SyncDirection = Literal["push", "import"]


ImportMode = Literal["new_only", "overwrite"]

class SyncRequest(BaseModel):
    direction: SyncDirection = "import"
    mode: Optional[ImportMode] = "new_only"
    source_currency: Optional[str] = None

PROVIDERS: dict[str, dict] = {
    "quickbooks": {"label": "QuickBooks", "group": "financial"},
    "xero":       {"label": "Xero",       "group": "financial"},
    "zoho_crm":   {"label": "Zoho CRM",   "group": "catalogue"},
    "stripe":     {"label": "Stripe",     "group": "financial"},
}

INTEGRATIONS_MIN_PLAN = "starter_insight"
PLAN_ORDER = ("explorer", "starter_insight", "decision_engine", "growth_navigator", "strategic_business_os")
PLAN_RANK = {plan: index for index, plan in enumerate(PLAN_ORDER)}


def _meets_min_plan(plan_key: str | None, minimum_plan: str = INTEGRATIONS_MIN_PLAN) -> bool:
    plan = normalise_plan_key(plan_key)
    return PLAN_RANK.get(plan, 0) >= PLAN_RANK.get(minimum_plan, 0)


async def _user_meets_integration_plan(user_id: str) -> bool:
    try:
        sub = await sb_select("user_subscriptions", filters=[("user_id", "eq", user_id)], single=True)
    except Exception:
        return False
    try:
        grants = await sb_select(
            "user_platform_grants",
            filters=[("user_id", "eq", user_id), ("module_key", "eq", "integrations")],
            columns="id,module_key,feature_key",
        )
        if grants:
            return True
    except Exception:
        pass
    if not sub:
        return False
    if str(sub.get("status") or "").lower() in {"expired", "cancelled", "canceled"}:
        return False
    return _meets_min_plan(sub.get("plan_key"))


async def _require_integration_plan(user_id: str) -> None:
    if not await _user_meets_integration_plan(user_id):
        raise HTTPException(status_code=403, detail="Integrations are available on the Starter plan and above.")


def _backend_url() -> str:
    settings = get_settings()
    # Prefer explicit BACKEND_URL (set in production on Render/etc.)
    if settings.backend_url:
        return str(settings.backend_url).rstrip("/")
    host = settings.api_host if settings.api_host != "0.0.0.0" else "localhost"
    port = settings.api_port
    return f"http://{host}:{port}"


def _frontend_url() -> str:
    settings = get_settings()
    url = settings.frontend_url
    if isinstance(url, list):
        url = url[0]
    return str(url).rstrip("/")


def _redirect_uri(provider: str) -> str:
    return f"{_backend_url()}/integrations/{provider}/callback"


def _redact_state_param(url: str) -> str:
    parts = urlsplit(url)
    query = []
    for key, value in parse_qsl(parts.query, keep_blank_values=True):
        if key == "state":
            query.append((key, "<redacted>"))
        else:
            query.append((key, value))
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))


_PROVIDER_ENV_NAMES: dict[str, tuple[str, str]] = {
    "quickbooks": ("QB_CLIENT_ID", "QB_CLIENT_SECRET"),
    "xero":       ("XERO_CLIENT_ID", "XERO_CLIENT_SECRET"),
    "zoho_crm":   ("ZOHO_CLIENT_ID", "ZOHO_CLIENT_SECRET"),
    "stripe":     ("STRIPE_CONNECT_CLIENT_ID", "STRIPE_SECRET_KEY"),
}

def _get_credentials(provider: str) -> tuple[str, str]:
    settings = get_settings()
    if provider == "quickbooks":
        return settings.qb_client_id or "", settings.qb_client_secret or ""
    if provider == "xero":
        return settings.xero_client_id or "", settings.xero_client_secret or ""
    if provider == "zoho_crm":
        return settings.zoho_client_id or "", settings.zoho_client_secret or ""
    if provider == "stripe":
        return settings.stripe_connect_client_id or "", settings.stripe_secret_key or ""
    raise HTTPException(status_code=400, detail=f"Unknown provider: {provider}")


async def _load_token_row(user_id: str, provider: str) -> dict | None:
    try:
        return await sb_select("integration_tokens", filters=[("user_id", "eq", user_id), ("provider", "eq", provider)], single=True)
    except Exception:
        return None


async def _save_tokens(user_id: str, provider: str, tokens: dict, extra_meta: dict | None = None) -> None:
    now = datetime.now(timezone.utc)
    expires_in = tokens.get("expires_in", 3600)
    expiry = (now + timedelta(seconds=expires_in)).isoformat()
    meta = {**(extra_meta or {}), "tenant_id": tokens.get("tenant_id", ""), "realm_id": tokens.get("realmId", "")}
    await sb_upsert(
        "integration_tokens",
        payload={
            "user_id": user_id,
            "provider": provider,
            "access_token": tokens.get("access_token", ""),
            "refresh_token": tokens.get("refresh_token", ""),
            "token_expiry": expiry,
            "metadata": meta,
            "connected_at": now.isoformat(),
            "last_sync_at": None,
        },
        on_conflict="user_id,provider",
    )


# ── Connect — return the OAuth authorization URL ──────────────────────────────

@router.get("/{provider}/connect")
async def connect(provider: Provider, user=Depends(get_current_user)) -> dict:
    if provider not in PROVIDERS:
        raise HTTPException(status_code=400, detail="Unknown provider.")
    await _require_integration_plan(user["id"])
    client_id, client_secret = _get_credentials(provider)
    if not client_id or not client_secret:
        id_name, secret_name = _PROVIDER_ENV_NAMES.get(provider, (f"{provider.upper()}_CLIENT_ID", f"{provider.upper()}_CLIENT_SECRET"))
        raise HTTPException(status_code=503, detail=f"{PROVIDERS[provider]['label']} OAuth credentials not configured. Add {id_name} and {secret_name} to your environment.")

    # Embed user identity in state so we can identify them in the callback
    state = create_access_token(subject=user["id"], extra={"provider": provider, "type": "oauth_state"})
    redirect_uri = _redirect_uri(provider)

    if provider == "quickbooks":
        url = qb.auth_url(client_id, redirect_uri, state)
    elif provider == "xero":
        url = xero_mod.auth_url(client_id, redirect_uri, state)
    elif provider == "stripe":
        url = stripe_mod.auth_url(client_id, redirect_uri, state)
    else:
        url = zoho_mod.auth_url(client_id, redirect_uri, state)

    if provider == "zoho_crm":
        logger.info(
            "Zoho OAuth connect prepared redirect_uri=%s auth_url=%s",
            redirect_uri,
            _redact_state_param(url),
        )

    return {"auth_url": url, "provider": provider}


# ── Callback — exchange code, store tokens, redirect to frontend ───────────────

@router.get("/{provider}/callback", include_in_schema=False)
async def callback(provider: Provider, code: str = "", state: str = "", error: str = "", realmId: str = ""):
    frontend = _frontend_url()

    if error or not code or not state:
        return RedirectResponse(f"{frontend}/integrations/callback?provider={provider}&status=error&reason={error or 'missing_code'}")

    try:
        payload = decode_token(state)
        user_id: str = payload["sub"]
        if payload.get("provider") != provider or payload.get("type") != "oauth_state":
            raise ValueError("Invalid state")
        if not await _user_meets_integration_plan(user_id):
            return RedirectResponse(f"{frontend}/integrations/callback?provider={provider}&status=error&reason=plan_locked")
    except Exception:
        return RedirectResponse(f"{frontend}/integrations/callback?provider={provider}&status=error&reason=invalid_state")

    client_id, client_secret = _get_credentials(provider)
    redirect_uri = _redirect_uri(provider)

    try:
        if provider == "zoho_crm":
            logger.info("Zoho OAuth callback starting redirect_uri=%s", redirect_uri)
        if provider == "quickbooks":
            tokens = await qb.exchange_code(client_id, client_secret, code, redirect_uri)
            tokens["realmId"] = realmId
        elif provider == "xero":
            tokens = await xero_mod.exchange_code(client_id, client_secret, code, redirect_uri)
        elif provider == "stripe":
            tokens = await stripe_mod.exchange_code(client_id, client_secret, code, redirect_uri)
        else:
            tokens = await zoho_mod.exchange_code(client_id, client_secret, code, redirect_uri)
    except Exception as e:
        logger.error("OAuth exchange failed for %s: %s", provider, e)
        return RedirectResponse(f"{frontend}/integrations/callback?provider={provider}&status=error&reason=exchange_failed")

    try:
        extra_meta = {"realm_id": realmId} if provider == "quickbooks" else None
        await _save_tokens(user_id, provider, tokens, extra_meta=extra_meta)
    except Exception as e:
        import urllib.parse
        detail = urllib.parse.quote(str(e)[:300])
        logger.error("Failed to store tokens for %s/%s: %s", provider, user_id, e)
        return RedirectResponse(f"{frontend}/integrations/callback?provider={provider}&status=error&reason=storage_failed&detail={detail}")

    return RedirectResponse(f"{frontend}/integrations/callback?provider={provider}&status=connected")


# QB sends realmId as a query param — add it to the callback route
@router.get("/quickbooks/callback", include_in_schema=False)
async def qb_callback(code: str = "", state: str = "", realmId: str = "", error: str = ""):
    frontend = _frontend_url()

    if error or not code or not state:
        return RedirectResponse(f"{frontend}/integrations/callback?provider=quickbooks&status=error&reason={error or 'missing_code'}")

    try:
        payload = decode_token(state)
        user_id: str = payload["sub"]
        if payload.get("provider") != "quickbooks" or payload.get("type") != "oauth_state":
            raise ValueError("Invalid state")
        if not await _user_meets_integration_plan(user_id):
            return RedirectResponse(f"{frontend}/integrations/callback?provider=quickbooks&status=error&reason=plan_locked")
    except Exception:
        return RedirectResponse(f"{frontend}/integrations/callback?provider=quickbooks&status=error&reason=invalid_state")

    client_id, client_secret = _get_credentials("quickbooks")
    redirect_uri = _redirect_uri("quickbooks")

    try:
        tokens = await qb.exchange_code(client_id, client_secret, code, redirect_uri)
        tokens["realmId"] = realmId
    except Exception as e:
        logger.error("QB OAuth exchange failed: %s", e)
        return RedirectResponse(f"{frontend}/integrations/callback?provider=quickbooks&status=error&reason=exchange_failed")

    try:
        await _save_tokens(user_id, "quickbooks", tokens, extra_meta={"realm_id": realmId})
    except Exception as e:
        logger.error("Failed to store QB tokens: %s", e)
        import urllib.parse
        detail = urllib.parse.quote(str(e)[:200])
        return RedirectResponse(f"{frontend}/integrations/callback?provider=quickbooks&status=error&reason=storage_failed&detail={detail}")

    return RedirectResponse(f"{frontend}/integrations/callback?provider=quickbooks&status=connected")


# ── Status — which providers are connected ────────────────────────────────────

@router.get("/status")
async def status(user=Depends(get_current_user)) -> dict:
    await _require_integration_plan(user["id"])
    result = {}
    for provider in PROVIDERS:
        row = await _load_token_row(user["id"], provider)
        connected = bool(row and (row.get("access_token") or row.get("refresh_token")))
        if provider == "zoho_crm":
            logger.info(
                "Zoho integration status user_id=%s connected=%s access_token=%s refresh_token=%s connected_at=%s last_sync_at=%s",
                user["id"],
                connected,
                bool(row and row.get("access_token")),
                bool(row and row.get("refresh_token")),
                (row or {}).get("connected_at"),
                (row or {}).get("last_sync_at"),
            )
        result[provider] = {
            "connected": connected,
            "connected_at": (row or {}).get("connected_at"),
            "last_sync_at": (row or {}).get("last_sync_at"),
        }
    return result


# ── Currency rate lookup (reuses shared 1-hour cache) ─────────────────────────

@router.get("/currency-rate")
async def currency_rate(
    from_currency: str,
    to_currency: str,
    user=Depends(get_current_user),
) -> dict:
    """Return the exchange rate from→to, or null if unavailable."""
    rate = await get_rate(from_currency.strip().upper(), to_currency.strip().upper())
    return {"from": from_currency.upper(), "to": to_currency.upper(), "rate": rate}


# ── Disconnect ────────────────────────────────────────────────────────────────

@router.delete("/{provider}")
async def disconnect(provider: Provider, user=Depends(get_current_user)) -> dict:
    if provider not in PROVIDERS:
        raise HTTPException(status_code=400, detail="Unknown provider.")
    await _require_integration_plan(user["id"])
    try:
        from app.core.supabase import sb_delete
        await sb_delete("integration_tokens", filters=[("user_id", "eq", user["id"]), ("provider", "eq", provider)])
    except Exception as e:
        logger.warning("Disconnect %s failed: %s", provider, e)
    return {"disconnected": True, "provider": provider}


async def _convert_financials(records: list[dict], target_currency: str) -> list[dict]:
    """Convert monetary fields in financial records to target_currency where source differs."""
    if not records or not target_currency:
        return records
    target = target_currency.upper()
    rate_cache: dict[str, float | None] = {}
    out = []
    for rec in records:
        src = (rec.get("source_currency") or "").upper()
        if not src or src == target:
            out.append(rec)
            continue
        if src not in rate_cache:
            rate_cache[src] = await get_rate(src, target)
        rate = rate_cache[src]
        if rate is None:
            out.append(rec)
            continue
        rec = dict(rec)
        for field in ("total_amount", "subtotal_amount", "vat_amount", "price"):
            if rec.get(field) is not None:
                rec[field] = convert_amount(float(rec[field]), rate)
        items = rec.get("items")
        if items:
            converted_items = []
            for item in items:
                item = dict(item)
                for f in ("unit_price", "subtotal"):
                    if item.get(f) is not None:
                        item[f] = convert_amount(float(item[f]), rate)
                converted_items.append(item)
            rec["items"] = converted_items
        out.append(rec)
    return out


def _infer_source_currency(financial_records: list[dict]) -> str | None:
    """Pick the most common source_currency from invoices/quotes as the org's default."""
    counts: dict[str, int] = {}
    for r in financial_records:
        sc = (r.get("source_currency") or "").upper()
        if sc:
            counts[sc] = counts.get(sc, 0) + 1
    return max(counts, key=lambda k: counts[k]) if counts else None


async def _convert_products(
    products: list[dict], target_currency: str, fallback_source_currency: str | None = None
) -> list[dict]:
    """Convert base_price and cost_of_sales to target_currency where source_currency differs.

    fallback_source_currency is used for products where source_currency is not set
    (e.g. Zoho products that don't carry a per-record Currency field).
    """
    if not products or not target_currency:
        return products
    target = target_currency.upper()
    rate_cache: dict[str, float | None] = {}
    out = []
    for p in products:
        src = (p.get("source_currency") or fallback_source_currency or "").upper()
        if not src or src == target:
            out.append(p)
            continue
        if src not in rate_cache:
            rate_cache[src] = await get_rate(src, target)
        rate = rate_cache[src]
        if rate is None:
            out.append(p)
            continue
        p = dict(p)
        p["source_currency"] = src  # stamp it so the record knows its origin
        if p.get("base_price") is not None:
            p["base_price"] = convert_amount(float(p["base_price"]), rate)
        if p.get("cost_of_sales"):
            p["cost_of_sales"] = convert_amount(float(p["cost_of_sales"]), rate)
        out.append(p)
    return out


def _get_workspace_currency(ws_data: dict) -> str:
    ctx = ws_data.get("context") or {}
    return (
        (ctx.get("resolved_currency") if isinstance(ctx, dict) else None)
        or (ctx.get("currency") if isinstance(ctx, dict) else None)
        or ws_data.get("currency")
        or "GBP"
    ).upper()


# ── Sync ──────────────────────────────────────────────────────────────────────

@router.post("/{provider}/sync")
async def sync(provider: Provider, payload: SyncRequest | None = None, user=Depends(get_current_user)) -> dict:
    if provider not in PROVIDERS:
        raise HTTPException(status_code=400, detail="Unknown provider.")
    await _require_integration_plan(user["id"])
    direction = (payload.direction if payload else "import").lower()
    mode: ImportMode = (payload.mode if payload and payload.mode else "new_only")
    user_source_currency: str | None = (payload.source_currency or "").upper() or None if payload else None
    if direction != "import":
        raise HTTPException(status_code=400, detail="Only 'import' direction is supported. Push/sync to external services is disabled.")

    row = await _load_token_row(user["id"], provider)
    if not row or not (row.get("access_token") or row.get("refresh_token")):
        raise HTTPException(status_code=400, detail=f"{PROVIDERS[provider]['label']} is not connected.")

    client_id, client_secret = _get_credentials(provider)
    meta = {
        "access_token": row["access_token"],
        "refresh_token": row.get("refresh_token", ""),
        "token_expiry": row.get("token_expiry", ""),
        "tenant_id": (row.get("metadata") or {}).get("tenant_id", ""),
        "realm_id": (row.get("metadata") or {}).get("realm_id", ""),
    }

    # Load workspace data
    ws = await get_user_workspace(user_id=user["id"])
    ws_data = (ws.data or {}) if ws else {}
    financials = ws_data.get("financials", {})
    catalogue = ws_data.get("catalogue", {})

    total_imported = 0
    all_errors: list[str] = []

    if provider == "quickbooks":
        fresh_access, new_meta = await qb._ensure_fresh(meta, client_id, client_secret)
        if new_meta:
            try:
                await sb_update(
                    "integration_tokens",
                    payload={
                        "access_token": new_meta["access_token"],
                        "refresh_token": new_meta["refresh_token"],
                        "token_expiry": new_meta["token_expiry"],
                    },
                    filters=[("user_id", "eq", user["id"]), ("provider", "eq", "quickbooks")],
                )
                meta.update(new_meta)
            except Exception:
                pass
        imported, import_errors, _ = await qb.import_from_quickbooks(meta, client_id, client_secret)
        all_errors += import_errors

        ws_currency = _get_workspace_currency(ws_data)
        if imported.get("invoices"):
            imported["invoices"] = await _convert_financials(imported["invoices"], ws_currency)
        if imported.get("expenses"):
            imported["expenses"] = await _convert_financials(imported["expenses"], ws_currency)
        if imported.get("products"):
            org_currency = user_source_currency or _infer_source_currency(imported.get("invoices", []) + imported.get("expenses", []))
            imported["products"] = await _convert_products(imported["products"], ws_currency, fallback_source_currency=org_currency)

        existing_catalogue = catalogue if isinstance(catalogue, dict) else {}
        now = datetime.now(timezone.utc).isoformat()
        merged_catalogue = {
            "products": zoho_mod._merge_catalogue_lists(existing_catalogue.get("products", []), imported.get("products", []), kind="products", now_iso=now, mode=mode),
            "customers": zoho_mod._merge_catalogue_lists(existing_catalogue.get("customers", []), imported.get("customers", []), kind="customers", now_iso=now, mode=mode),
            "vendors": zoho_mod._merge_catalogue_lists(existing_catalogue.get("vendors", []), imported.get("vendors", []), kind="vendors", now_iso=now, mode=mode),
        }
        await upsert_user_workspace(user_id=user["id"], data_patch={"catalogue": merged_catalogue})

        existing_financials = financials if isinstance(financials, dict) else {}
        merged_financials = dict(existing_financials)
        if imported.get("invoices"):
            merged_financials["invoices"] = zoho_mod._merge_financials_list(
                existing_financials.get("invoices", []), imported["invoices"], mode=mode
            )
        if imported.get("expenses"):
            merged_financials["expenses"] = zoho_mod._merge_financials_list(
                existing_financials.get("expenses", []), imported["expenses"], mode=mode
            )
        if imported.get("invoices") or imported.get("expenses"):
            await upsert_user_workspace(user_id=user["id"], data_patch={"financials": merged_financials})

        if mode == "new_only":
            total_imported = max(0, (
                len(merged_catalogue.get("products", [])) - len(existing_catalogue.get("products", []))
                + len(merged_catalogue.get("customers", [])) - len(existing_catalogue.get("customers", []))
                + len(merged_catalogue.get("vendors", [])) - len(existing_catalogue.get("vendors", []))
                + len(merged_financials.get("invoices", [])) - len(existing_financials.get("invoices", []))
                + len(merged_financials.get("expenses", [])) - len(existing_financials.get("expenses", []))
            ))
        else:
            total_imported = sum(len(imported.get(k, [])) for k in ("products", "customers", "vendors", "invoices", "expenses"))

    elif provider == "xero":
        fresh_access, new_meta = await xero_mod._ensure_fresh(meta, client_id, client_secret)
        if new_meta:
            try:
                await sb_update(
                    "integration_tokens",
                    payload={
                        "access_token": new_meta["access_token"],
                        "refresh_token": new_meta["refresh_token"],
                        "token_expiry": new_meta["token_expiry"],
                    },
                    filters=[("user_id", "eq", user["id"]), ("provider", "eq", "xero")],
                )
                meta.update(new_meta)
            except Exception:
                pass
        imported, import_errors = await xero_mod.import_from_xero(meta, client_id, client_secret)
        all_errors += import_errors
        now = datetime.now(timezone.utc).isoformat()

        ws_currency = _get_workspace_currency(ws_data)
        if imported.get("invoices"):
            imported["invoices"] = await _convert_financials(imported["invoices"], ws_currency)
        if imported.get("expenses"):
            imported["expenses"] = await _convert_financials(imported["expenses"], ws_currency)
        if imported.get("quotes"):
            imported["quotes"] = await _convert_financials(imported["quotes"], ws_currency)
        if imported.get("products"):
            org_currency = user_source_currency or _infer_source_currency(imported.get("invoices", []) + imported.get("expenses", []))
            imported["products"] = await _convert_products(imported["products"], ws_currency, fallback_source_currency=org_currency)

        existing_catalogue = catalogue if isinstance(catalogue, dict) else {}
        merged_catalogue = {
            "products": zoho_mod._merge_catalogue_lists(existing_catalogue.get("products", []), imported.get("products", []), kind="products", now_iso=now, mode=mode),
            "customers": zoho_mod._merge_catalogue_lists(existing_catalogue.get("customers", []), imported.get("customers", []), kind="customers", now_iso=now, mode=mode),
            "vendors": zoho_mod._merge_catalogue_lists(existing_catalogue.get("vendors", []), imported.get("vendors", []), kind="vendors", now_iso=now, mode=mode),
        }
        await upsert_user_workspace(user_id=user["id"], data_patch={"catalogue": merged_catalogue})

        existing_financials = financials if isinstance(financials, dict) else {}
        merged_financials = dict(existing_financials)
        if imported.get("invoices"):
            merged_financials["invoices"] = zoho_mod._merge_financials_list(
                existing_financials.get("invoices", []), imported["invoices"], mode=mode
            )
        if imported.get("expenses"):
            merged_financials["expenses"] = zoho_mod._merge_financials_list(
                existing_financials.get("expenses", []), imported["expenses"], mode=mode
            )
        if imported.get("quotes"):
            merged_financials["quotes"] = zoho_mod._merge_financials_list(
                existing_financials.get("quotes", []), imported["quotes"], mode=mode
            )
        if imported.get("invoices") or imported.get("expenses") or imported.get("quotes"):
            await upsert_user_workspace(user_id=user["id"], data_patch={"financials": merged_financials})

        if mode == "new_only":
            total_imported = max(0, (
                len(merged_catalogue.get("products", [])) - len(existing_catalogue.get("products", []))
                + len(merged_catalogue.get("customers", [])) - len(existing_catalogue.get("customers", []))
                + len(merged_catalogue.get("vendors", [])) - len(existing_catalogue.get("vendors", []))
                + len(merged_financials.get("invoices", [])) - len(existing_financials.get("invoices", []))
                + len(merged_financials.get("expenses", [])) - len(existing_financials.get("expenses", []))
                + len(merged_financials.get("quotes", [])) - len(existing_financials.get("quotes", []))
            ))
        else:
            total_imported = sum(len(imported.get(k, [])) for k in ("products", "customers", "vendors", "invoices", "expenses", "quotes"))

    elif provider == "zoho_crm":
        # Refresh token BEFORE importing so we can persist the new token to DB
        fresh_access, new_meta = await zoho_mod._ensure_fresh(meta, client_id, client_secret)
        if new_meta:
            try:
                await sb_update(
                    "integration_tokens",
                    payload={
                        "access_token": new_meta["access_token"],
                        "refresh_token": new_meta["refresh_token"],
                        "token_expiry": new_meta["token_expiry"],
                    },
                    filters=[("user_id", "eq", user["id"]), ("provider", "eq", provider)],
                )
                meta.update(new_meta)
            except Exception:
                pass
        imported, import_errors = await zoho_mod.import_catalogue(meta, client_id, client_secret)
        all_errors += import_errors
        now = datetime.now(timezone.utc).isoformat()

        ws_currency = _get_workspace_currency(ws_data)
        if imported.get("invoices"):
            imported["invoices"] = await _convert_financials(imported["invoices"], ws_currency)
        if imported.get("quotes"):
            imported["quotes"] = await _convert_financials(imported["quotes"], ws_currency)
        if imported.get("products"):
            org_currency = user_source_currency or _infer_source_currency(imported.get("invoices", []) + imported.get("quotes", []))
            imported["products"] = await _convert_products(imported["products"], ws_currency, fallback_source_currency=org_currency)

        # Merge catalogue (products, customers, vendors)
        existing_catalogue = catalogue if isinstance(catalogue, dict) else {}
        merged_catalogue = {
            "products": zoho_mod._merge_catalogue_lists(existing_catalogue.get("products", []), imported.get("products", []), kind="products", now_iso=now, mode=mode),
            "customers": zoho_mod._merge_catalogue_lists(existing_catalogue.get("customers", []), imported.get("customers", []), kind="customers", now_iso=now, mode=mode),
            "vendors": zoho_mod._merge_catalogue_lists(existing_catalogue.get("vendors", []), imported.get("vendors", []), kind="vendors", now_iso=now, mode=mode),
        }
        await upsert_user_workspace(user_id=user["id"], data_patch={"catalogue": merged_catalogue})

        # Merge financials (invoices, quotes)
        existing_financials = financials if isinstance(financials, dict) else {}
        merged_financials = dict(existing_financials)
        if imported.get("invoices"):
            merged_financials["invoices"] = zoho_mod._merge_financials_list(
                existing_financials.get("invoices", []), imported["invoices"], mode=mode
            )
        if imported.get("quotes"):
            merged_financials["quotes"] = zoho_mod._merge_financials_list(
                existing_financials.get("quotes", []), imported["quotes"], mode=mode
            )
        if imported.get("invoices") or imported.get("quotes"):
            await upsert_user_workspace(user_id=user["id"], data_patch={"financials": merged_financials})

        if mode == "new_only":
            total_imported = max(0, (
                len(merged_catalogue.get("products", [])) - len(existing_catalogue.get("products", []))
                + len(merged_catalogue.get("customers", [])) - len(existing_catalogue.get("customers", []))
                + len(merged_catalogue.get("vendors", [])) - len(existing_catalogue.get("vendors", []))
                + len(merged_financials.get("invoices", [])) - len(existing_financials.get("invoices", []))
                + len(merged_financials.get("quotes", [])) - len(existing_financials.get("quotes", []))
            ))
        else:
            total_imported = sum(len(imported.get(k, [])) for k in ("products", "customers", "vendors", "invoices", "quotes"))

    elif provider == "stripe":
        imported, import_errors = await stripe_mod.import_from_stripe(meta)
        all_errors += import_errors
        now = datetime.now(timezone.utc).isoformat()

        ws_currency = _get_workspace_currency(ws_data)
        if imported.get("invoices"):
            imported["invoices"] = await _convert_financials(imported["invoices"], ws_currency)
        if imported.get("products"):
            org_currency = user_source_currency or _infer_source_currency(imported.get("invoices", []))
            imported["products"] = await _convert_products(imported["products"], ws_currency, fallback_source_currency=org_currency)

        existing_catalogue = catalogue if isinstance(catalogue, dict) else {}
        merged_catalogue = {
            "products": zoho_mod._merge_catalogue_lists(existing_catalogue.get("products", []), imported.get("products", []), kind="products", now_iso=now, mode=mode),
            "customers": zoho_mod._merge_catalogue_lists(existing_catalogue.get("customers", []), imported.get("customers", []), kind="customers", now_iso=now, mode=mode),
            "vendors": zoho_mod._merge_catalogue_lists(existing_catalogue.get("vendors", []), [], kind="vendors", now_iso=now, mode=mode),
        }
        await upsert_user_workspace(user_id=user["id"], data_patch={"catalogue": merged_catalogue})

        existing_financials = financials if isinstance(financials, dict) else {}
        merged_financials = dict(existing_financials)
        if imported.get("invoices"):
            merged_financials["invoices"] = zoho_mod._merge_financials_list(
                existing_financials.get("invoices", []), imported["invoices"], mode=mode
            )
            await upsert_user_workspace(user_id=user["id"], data_patch={"financials": merged_financials})

        if mode == "new_only":
            total_imported = max(0, (
                len(merged_catalogue.get("products", [])) - len(existing_catalogue.get("products", []))
                + len(merged_catalogue.get("customers", [])) - len(existing_catalogue.get("customers", []))
                + len(merged_financials.get("invoices", [])) - len(existing_financials.get("invoices", []))
            ))
        else:
            total_imported = sum(len(imported.get(k, [])) for k in ("products", "customers", "invoices"))

    # Update last_sync_at
    try:
        await sb_update(
            "integration_tokens",
            payload={"last_sync_at": datetime.now(timezone.utc).isoformat()},
            filters=[("user_id", "eq", user["id"]), ("provider", "eq", provider)],
        )
    except Exception:
        pass

    return {
        "imported": total_imported,
        "errors": all_errors,
        "provider": provider,
        "direction": "import",
    }
