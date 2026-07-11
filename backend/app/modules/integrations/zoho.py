from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx

logger = logging.getLogger(__name__)

ZOHO_SCOPES = "ZohoCRM.modules.ALL,ZohoCRM.settings.ALL"

ZOHO_DATA_CENTERS = {
    "com": ("accounts.zoho.com", "www.zohoapis.com"),
    "us": ("accounts.zoho.com", "www.zohoapis.com"),
    "eu": ("accounts.zoho.eu", "www.zohoapis.eu"),
    "in": ("accounts.zoho.in", "www.zohoapis.in"),
    "au": ("accounts.zoho.com.au", "www.zohoapis.com.au"),
    "com.au": ("accounts.zoho.com.au", "www.zohoapis.com.au"),
    "jp": ("accounts.zoho.jp", "www.zohoapis.jp"),
    "ca": ("accounts.zohocloud.ca", "www.zohoapis.ca"),
    "sa": ("accounts.zoho.sa", "www.zohoapis.sa"),
}


def _region() -> str:
    from app.core.config import get_settings
    return (get_settings().zoho_region or "com").strip().lower()


def _domains() -> tuple[str, str]:
    region = _region()
    if region in ZOHO_DATA_CENTERS:
        return ZOHO_DATA_CENTERS[region]

    if region.startswith("accounts."):
        suffix = region.removeprefix("accounts.zoho.")
        if region == "accounts.zohocloud.ca":
            return region, "www.zohoapis.ca"
        return region, f"www.zohoapis.{suffix}"

    if region == "zohocloud.ca":
        return "accounts.zohocloud.ca", "www.zohoapis.ca"

    if region.startswith("zoho.") or region.startswith("zohocloud."):
        return f"accounts.{region}", f"www.zohoapis.{region.removeprefix('zoho.')}"

    return f"accounts.zoho.{region}", f"www.zohoapis.{region}"


def _auth_url() -> str:
    accounts_domain, _ = _domains()
    return f"https://{accounts_domain}/oauth/v2/auth"


def _token_url() -> str:
    accounts_domain, _ = _domains()
    return f"https://{accounts_domain}/oauth/v2/token"


def _api_base() -> str:
    _, api_domain = _domains()
    return f"https://{api_domain}/crm/v3"


def auth_url(client_id: str, redirect_uri: str, state: str) -> str:
    from urllib.parse import urlencode
    params = {
        "scope": ZOHO_SCOPES,
        "client_id": client_id,
        "response_type": "code",
        "access_type": "offline",
        "redirect_uri": redirect_uri,
        "state": state,
    }
    return f"{_auth_url()}?{urlencode(params)}"


async def exchange_code(client_id: str, client_secret: str, code: str, redirect_uri: str) -> dict:
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            _token_url(),
            params={
                "grant_type": "authorization_code",
                "client_id": client_id,
                "client_secret": client_secret,
                "redirect_uri": redirect_uri,
                "code": code,
            },
        )
        resp.raise_for_status()
        return resp.json()


async def _refresh(client_id: str, client_secret: str, token: str) -> dict:
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            _token_url(),
            params={
                "grant_type": "refresh_token",
                "client_id": client_id,
                "client_secret": client_secret,
                "refresh_token": token,
            },
        )
        resp.raise_for_status()
        return resp.json()


async def _ensure_fresh(meta: dict, client_id: str, client_secret: str) -> tuple[str, dict | None]:
    expiry_str = meta.get("token_expiry")
    access = meta.get("access_token", "")
    refresh = meta.get("refresh_token", "")
    if expiry_str and refresh:
        try:
            expiry = datetime.fromisoformat(expiry_str)
            now = datetime.now(timezone.utc)
            if expiry.tzinfo is None:
                expiry = expiry.replace(tzinfo=timezone.utc)
            if (expiry - now).total_seconds() < 300:
                new_tokens = await _refresh(client_id, client_secret, refresh)
                new_meta = {
                    **meta,
                    "access_token": new_tokens["access_token"],
                    "refresh_token": new_tokens.get("refresh_token", refresh),
                    "token_expiry": (now + timedelta(seconds=new_tokens.get("expires_in", 3600))).isoformat(),
                }
                return new_tokens["access_token"], new_meta
        except Exception as e:
            logger.warning("Zoho token refresh failed: %s", e)
    return access, None


def _headers(access_token: str) -> dict:
    return {"Authorization": f"Zoho-oauthtoken {access_token}", "Content-Type": "application/json"}


async def sync_products(meta: dict, products: list[dict], client_id: str, client_secret: str) -> tuple[int, list[str]]:
    access, _ = await _ensure_fresh(meta, client_id, client_secret)
    synced, errors = 0, []
    async with httpx.AsyncClient(timeout=20) as client:
        for p in products:
            if p.get("archived"):
                continue
            body: dict[str, Any] = {
                "Product_Name": p.get("name", "Unknown"),
                "Unit_Price": float(p.get("base_price", 0)),
                "Product_Category": p.get("category") or p.get("type", ""),
                "Description": f"Cost of sales: {p.get('cost_of_sales', 0)}",
            }
            try:
                resp = await client.post(
                    f"{_api_base()}/Products",
                    json={"data": [body]},
                    headers=_headers(access),
                )
                resp.raise_for_status()
                data = resp.json()
                if data.get("data", [{}])[0].get("status") == "error":
                    errors.append(f"Product '{p.get('name')}': {data['data'][0].get('message', 'Unknown error')}")
                else:
                    synced += 1
            except httpx.HTTPStatusError as e:
                errors.append(f"Product '{p.get('name')}': {e.response.text[:120]}")
    return synced, errors


async def sync_contacts(meta: dict, customers: list[dict], client_id: str, client_secret: str) -> tuple[int, list[str]]:
    access, _ = await _ensure_fresh(meta, client_id, client_secret)
    synced, errors = 0, []
    async with httpx.AsyncClient(timeout=20) as client:
        for c in customers:
            if c.get("archived"):
                continue
            name_parts = (c.get("name", "Unknown")).split(" ", 1)
            body: dict[str, Any] = {
                "Last_Name": name_parts[-1],
                "First_Name": name_parts[0] if len(name_parts) > 1 else "",
                "Email": c.get("email", ""),
                "Phone": c.get("phone_number", ""),
                "Mailing_Street": c.get("address", ""),
                "Industry": c.get("industry", ""),
            }
            try:
                resp = await client.post(
                    f"{_api_base()}/Contacts",
                    json={"data": [body]},
                    headers=_headers(access),
                )
                resp.raise_for_status()
                data = resp.json()
                if data.get("data", [{}])[0].get("status") == "error":
                    errors.append(f"Contact '{c.get('name')}': {data['data'][0].get('message', 'Unknown error')}")
                else:
                    synced += 1
            except httpx.HTTPStatusError as e:
                errors.append(f"Contact '{c.get('name')}': {e.response.text[:120]}")
    return synced, errors


async def sync_vendors(meta: dict, vendors: list[dict], client_id: str, client_secret: str) -> tuple[int, list[str]]:
    access, _ = await _ensure_fresh(meta, client_id, client_secret)
    synced, errors = 0, []
    async with httpx.AsyncClient(timeout=20) as client:
        for v in vendors:
            if v.get("archived"):
                continue
            body: dict[str, Any] = {
                "Vendor_Name": v.get("name", "Unknown"),
                "Email": v.get("email", ""),
                "Phone": v.get("phone_number", ""),
                "Street": v.get("address", ""),
                "Category": v.get("industry", ""),
            }
            try:
                resp = await client.post(
                    f"{_api_base()}/Vendors",
                    json={"data": [body]},
                    headers=_headers(access),
                )
                resp.raise_for_status()
                data = resp.json()
                if data.get("data", [{}])[0].get("status") == "error":
                    errors.append(f"Vendor '{v.get('name')}': {data['data'][0].get('message', 'Unknown error')}")
                else:
                    synced += 1
            except httpx.HTTPStatusError as e:
                errors.append(f"Vendor '{v.get('name')}': {e.response.text[:120]}")
    return synced, errors
