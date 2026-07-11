from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx

logger = logging.getLogger(__name__)

QB_AUTH_URL = "https://appcenter.intuit.com/connect/oauth2"
QB_TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer"
QB_API_BASE = "https://quickbooks.api.intuit.com/v3/company"
QB_SCOPES = "com.intuit.quickbooks.accounting"


def auth_url(client_id: str, redirect_uri: str, state: str) -> str:
    from urllib.parse import urlencode
    params = {
        "client_id": client_id,
        "response_type": "code",
        "scope": QB_SCOPES,
        "redirect_uri": redirect_uri,
        "state": state,
    }
    return f"{QB_AUTH_URL}?{urlencode(params)}"


async def exchange_code(client_id: str, client_secret: str, code: str, redirect_uri: str) -> dict:
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            QB_TOKEN_URL,
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": redirect_uri,
            },
            auth=(client_id, client_secret),
            headers={"Accept": "application/json"},
        )
        resp.raise_for_status()
        return resp.json()


async def refresh_token(client_id: str, client_secret: str, token: str) -> dict:
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            QB_TOKEN_URL,
            data={"grant_type": "refresh_token", "refresh_token": token},
            auth=(client_id, client_secret),
            headers={"Accept": "application/json"},
        )
        resp.raise_for_status()
        return resp.json()


def _headers(access_token: str) -> dict:
    return {"Authorization": f"Bearer {access_token}", "Accept": "application/json", "Content-Type": "application/json"}


async def _ensure_fresh(meta: dict, client_id: str, client_secret: str) -> tuple[str, dict | None]:
    """Return (access_token, updated_meta_or_None). Refreshes if within 5 min of expiry."""
    expiry_str = meta.get("token_expiry")
    access = meta.get("access_token", "")
    refresh = meta.get("refresh_token", "")
    if expiry_str:
        try:
            expiry = datetime.fromisoformat(expiry_str)
            now = datetime.now(timezone.utc)
            if expiry.tzinfo is None:
                expiry = expiry.replace(tzinfo=timezone.utc)
            if (expiry - now).total_seconds() < 300 and refresh:
                new_tokens = await refresh_token(client_id, client_secret, refresh)
                new_meta = {
                    **meta,
                    "access_token": new_tokens["access_token"],
                    "refresh_token": new_tokens.get("refresh_token", refresh),
                    "token_expiry": (now + timedelta(seconds=new_tokens.get("expires_in", 3600))).isoformat(),
                }
                return new_tokens["access_token"], new_meta
        except Exception as e:
            logger.warning("QB token refresh failed: %s", e)
    return access, None


async def import_workspace_data(meta: dict, client_id: str, client_secret: str) -> dict:
    access, updated_meta = await _ensure_fresh(meta, client_id, client_secret)
    realm_id = meta.get("realm_id", "")
    if not realm_id:
        return {
            "catalogue": {"customers": [], "vendors": []},
            "financials": {"invoices": [], "expenses": []},
            "imported": {"customers": 0, "vendors": 0, "invoices": 0, "expenses": 0},
            "errors": ["QuickBooks company ID is missing. Disconnect and reconnect QuickBooks."],
            "updated_meta": updated_meta,
        }

    async def query(entity: str) -> list[dict]:
        q = f"select * from {entity} startposition 1 maxresults 100"
        resp = await client.get(
            f"{QB_API_BASE}/{realm_id}/query",
            headers=_headers(access),
            params={"query": q, "minorversion": "65"},
        )
        resp.raise_for_status()
        return resp.json().get("QueryResponse", {}).get(entity, []) or []

    now = datetime.now(timezone.utc).isoformat()
    errors: list[str] = []
    async with httpx.AsyncClient(timeout=30) as client:
        try:
            qb_customers = await query("Customer")
        except httpx.HTTPStatusError as e:
            qb_customers = []
            errors.append(f"Customers: {e.response.text[:160]}")
        try:
            qb_vendors = await query("Vendor")
        except httpx.HTTPStatusError as e:
            qb_vendors = []
            errors.append(f"Vendors: {e.response.text[:160]}")
        try:
            qb_invoices = await query("Invoice")
        except httpx.HTTPStatusError as e:
            qb_invoices = []
            errors.append(f"Invoices: {e.response.text[:160]}")
        try:
            qb_purchases = await query("Purchase")
        except httpx.HTTPStatusError as e:
            qb_purchases = []
            errors.append(f"Purchases: {e.response.text[:160]}")

    customers = [_map_customer(item, now) for item in qb_customers if item.get("Id")]
    vendors = [_map_vendor(item, now) for item in qb_vendors if item.get("Id")]
    invoices = [_map_invoice(item, now) for item in qb_invoices if item.get("Id")]
    expenses = [_map_purchase(item, now) for item in qb_purchases if item.get("Id")]

    return {
        "catalogue": {"customers": customers, "vendors": vendors},
        "financials": {"invoices": invoices, "expenses": expenses},
        "imported": {
            "customers": len(customers),
            "vendors": len(vendors),
            "invoices": len(invoices),
            "expenses": len(expenses),
        },
        "errors": errors,
        "updated_meta": updated_meta,
    }


def _address_line(value: dict | None) -> str:
    if not isinstance(value, dict):
        return ""
    return ", ".join(str(value.get(k) or "").strip() for k in ("Line1", "City", "CountrySubDivisionCode", "PostalCode") if value.get(k))


def _map_customer(item: dict, now: str) -> dict:
    return {
        "id": f"qb_customer_{item.get('Id')}",
        "quickbooks_id": str(item.get("Id")),
        "source": "quickbooks",
        "name": item.get("DisplayName") or item.get("FullyQualifiedName") or "QuickBooks customer",
        "address": _address_line(item.get("BillAddr")),
        "email": ((item.get("PrimaryEmailAddr") or {}).get("Address") or ""),
        "phone_number": ((item.get("PrimaryPhone") or {}).get("FreeFormNumber") or ""),
        "payment_terms": "14",
        "industry": "",
        "archived": False,
        "created_at": now,
        "updated_at": now,
    }


def _map_vendor(item: dict, now: str) -> dict:
    return {
        "id": f"qb_vendor_{item.get('Id')}",
        "quickbooks_id": str(item.get("Id")),
        "source": "quickbooks",
        "name": item.get("DisplayName") or item.get("PrintOnCheckName") or "QuickBooks vendor",
        "address": _address_line(item.get("BillAddr")),
        "email": ((item.get("PrimaryEmailAddr") or {}).get("Address") or ""),
        "phone_number": ((item.get("PrimaryPhone") or {}).get("FreeFormNumber") or ""),
        "payment_terms": "14",
        "industry": "",
        "product_type": "service",
        "product_name": "",
        "price": 0,
        "archived": False,
        "created_at": now,
        "updated_at": now,
    }


def _map_invoice(item: dict, now: str) -> dict:
    lines = []
    for line in item.get("Line") or []:
        detail = line.get("SalesItemLineDetail") or {}
        item_ref = detail.get("ItemRef") or {}
        if line.get("DetailType") != "SalesItemLineDetail":
            continue
        qty = float(detail.get("Qty") or 1)
        amount = float(line.get("Amount") or 0)
        unit_price = float(detail.get("UnitPrice") or (amount / qty if qty else amount))
        name = item_ref.get("name") or line.get("Description") or "QuickBooks item"
        lines.append({
            "product_id": f"qb_item_{item_ref.get('value') or name}",
            "product_name": name,
            "quantity": qty,
            "unit_price": unit_price,
            "unit_cost_of_sales": 0,
            "subtotal_amount": amount,
        })
    total = float(item.get("TotalAmt") or 0)
    balance = float(item.get("Balance") or 0)
    customer_ref = item.get("CustomerRef") or {}
    return {
        "id": f"qb_invoice_{item.get('Id')}",
        "quickbooks_id": str(item.get("Id")),
        "source": "quickbooks",
        "invoice_id": item.get("DocNumber") or f"QB-{item.get('Id')}",
        "customer_id": f"qb_customer_{customer_ref.get('value')}" if customer_ref.get("value") else "",
        "customer_name": customer_ref.get("name") or "",
        "product_id": lines[0]["product_id"] if lines else "qb_item_service",
        "product_ids": [line["product_id"] for line in lines] or ["qb_item_service"],
        "product_name": lines[0]["product_name"] if lines else "QuickBooks invoice",
        "product_names": [line["product_name"] for line in lines] or ["QuickBooks invoice"],
        "items": lines,
        "quantity": sum(float(line.get("quantity") or 0) for line in lines) or 1,
        "unit_price": lines[0]["unit_price"] if len(lines) == 1 else None,
        "unit_cost_of_sales": 0,
        "subtotal_amount": total,
        "cost_of_sales": 0,
        "total_amount": total,
        "status": "paid" if balance <= 0 else "pending",
        "issued_at": item.get("TxnDate") or None,
        "due_date": item.get("DueDate") or None,
        "archived": False,
        "created_at": now,
        "updated_at": now,
    }


def _map_purchase(item: dict, now: str) -> dict:
    first_line = next((line for line in item.get("Line") or [] if line.get("DetailType") == "AccountBasedExpenseLineDetail"), {})
    detail = first_line.get("AccountBasedExpenseLineDetail") or {}
    account_ref = detail.get("AccountRef") or {}
    entity_ref = item.get("EntityRef") or {}
    total = float(item.get("TotalAmt") or first_line.get("Amount") or 0)
    return {
        "id": f"qb_purchase_{item.get('Id')}",
        "quickbooks_id": str(item.get("Id")),
        "source": "quickbooks",
        "vendor_id": f"qb_vendor_{entity_ref.get('value')}" if entity_ref.get("value") else "",
        "vendor_name": entity_ref.get("name") or "",
        "item": first_line.get("Description") or account_ref.get("name") or item.get("DocNumber") or "QuickBooks expense",
        "description": first_line.get("Description") or "",
        "price": total,
        "total_amount": total,
        "cost_type": "variable",
        "status": "paid",
        "incurred_at": item.get("TxnDate") or None,
        "due_date": None,
        "archived": False,
        "created_at": now,
        "updated_at": now,
    }


async def sync_customers(meta: dict, customers: list[dict], client_id: str, client_secret: str) -> tuple[int, list[str]]:
    access, updated_meta = await _ensure_fresh(meta, client_id, client_secret)
    realm_id = meta.get("realm_id", "")
    synced, errors = 0, []
    async with httpx.AsyncClient(timeout=20) as client:
        for c in customers:
            if c.get("archived"):
                continue
            body = {
                "DisplayName": c.get("name", "Unknown"),
                "PrimaryEmailAddr": {"Address": c.get("email", "")} if c.get("email") else None,
                "PrimaryPhone": {"FreeFormNumber": c.get("phone_number", "")} if c.get("phone_number") else None,
                "BillAddr": {"Line1": c.get("address", "")} if c.get("address") else None,
                "Notes": c.get("industry", ""),
            }
            body = {k: v for k, v in body.items() if v is not None}
            try:
                resp = await client.post(
                    f"{QB_API_BASE}/{realm_id}/customer",
                    json=body,
                    headers=_headers(access),
                    params={"minorversion": "65"},
                )
                resp.raise_for_status()
                synced += 1
            except httpx.HTTPStatusError as e:
                errors.append(f"Customer '{c.get('name')}': {e.response.text[:120]}")
    return synced, errors


async def sync_vendors(meta: dict, vendors: list[dict], client_id: str, client_secret: str) -> tuple[int, list[str]]:
    access, _ = await _ensure_fresh(meta, client_id, client_secret)
    realm_id = meta.get("realm_id", "")
    synced, errors = 0, []
    async with httpx.AsyncClient(timeout=20) as client:
        for v in vendors:
            if v.get("archived"):
                continue
            body = {
                "DisplayName": v.get("name", "Unknown"),
                "PrimaryEmailAddr": {"Address": v.get("email", "")} if v.get("email") else None,
                "PrimaryPhone": {"FreeFormNumber": v.get("phone_number", "")} if v.get("phone_number") else None,
                "BillAddr": {"Line1": v.get("address", "")} if v.get("address") else None,
            }
            body = {k: val for k, val in body.items() if val is not None}
            try:
                resp = await client.post(
                    f"{QB_API_BASE}/{realm_id}/vendor",
                    json=body,
                    headers=_headers(access),
                    params={"minorversion": "65"},
                )
                resp.raise_for_status()
                synced += 1
            except httpx.HTTPStatusError as e:
                errors.append(f"Vendor '{v.get('name')}': {e.response.text[:120]}")
    return synced, errors


async def sync_invoices(meta: dict, invoices: list[dict], client_id: str, client_secret: str) -> tuple[int, list[str]]:
    access, _ = await _ensure_fresh(meta, client_id, client_secret)
    realm_id = meta.get("realm_id", "")
    synced, errors = 0, []
    async with httpx.AsyncClient(timeout=20) as client:
        for inv in invoices:
            if inv.get("archived"):
                continue
            items = inv.get("items") or []
            line_items: list[dict[str, Any]] = []
            for i, item in enumerate(items, start=1):
                line_items.append({
                    "Id": str(i),
                    "Amount": float(item.get("unit_price", 0)) * int(item.get("quantity", 1)),
                    "DetailType": "SalesItemLineDetail",
                    "SalesItemLineDetail": {
                        "ItemRef": {"value": "1", "name": item.get("product_name", "Service")},
                        "Qty": item.get("quantity", 1),
                        "UnitPrice": item.get("unit_price", 0),
                    },
                })
            if not line_items:
                line_items = [{
                    "Amount": float(inv.get("total_amount", 0)),
                    "DetailType": "SalesItemLineDetail",
                    "SalesItemLineDetail": {"ItemRef": {"value": "1", "name": "Service"}, "Qty": 1, "UnitPrice": inv.get("total_amount", 0)},
                }]
            body: dict[str, Any] = {"Line": line_items}
            if inv.get("customer_name"):
                body["CustomerRef"] = {"name": inv["customer_name"]}
            if inv.get("due_date"):
                body["DueDate"] = inv["due_date"][:10]
            if inv.get("issued_at"):
                body["TxnDate"] = inv["issued_at"][:10]
            try:
                resp = await client.post(
                    f"{QB_API_BASE}/{realm_id}/invoice",
                    json=body,
                    headers=_headers(access),
                    params={"minorversion": "65"},
                )
                resp.raise_for_status()
                synced += 1
            except httpx.HTTPStatusError as e:
                errors.append(f"Invoice '{inv.get('invoice_id', inv.get('id', ''))}': {e.response.text[:120]}")
    return synced, errors


async def sync_expenses(meta: dict, expenses: list[dict], client_id: str, client_secret: str) -> tuple[int, list[str]]:
    access, _ = await _ensure_fresh(meta, client_id, client_secret)
    realm_id = meta.get("realm_id", "")
    synced, errors = 0, []
    async with httpx.AsyncClient(timeout=20) as client:
        for exp in expenses:
            if exp.get("archived"):
                continue
            body: dict[str, Any] = {
                "PaymentType": "Cash",
                "AccountRef": {"value": "1"},
                "Line": [{
                    "Amount": float(exp.get("total_amount", exp.get("price", 0))),
                    "DetailType": "AccountBasedExpenseLineDetail",
                    "AccountBasedExpenseLineDetail": {
                        "AccountRef": {"value": "1"},
                        "BillableStatus": "NotBillable",
                    },
                    "Description": exp.get("description") or exp.get("item", ""),
                }],
            }
            if exp.get("vendor_name"):
                body["EntityRef"] = {"name": exp["vendor_name"], "type": "Vendor"}
            if exp.get("incurred_at"):
                body["TxnDate"] = exp["incurred_at"][:10]
            try:
                resp = await client.post(
                    f"{QB_API_BASE}/{realm_id}/purchase",
                    json=body,
                    headers=_headers(access),
                    params={"minorversion": "65"},
                )
                resp.raise_for_status()
                synced += 1
            except httpx.HTTPStatusError as e:
                errors.append(f"Expense '{exp.get('item', '')}': {e.response.text[:120]}")
    return synced, errors
