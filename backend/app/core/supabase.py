from __future__ import annotations

import time
from typing import Any, Iterable

import anyio
from supabase import Client, ClientOptions, create_client

from app.core.config import get_settings

def _make_client() -> Client:
    settings = get_settings()
    if not settings.supabase_url or not settings.supabase_service_role_key:
        raise RuntimeError("Supabase URL / service role key not configured")
    return create_client(
        settings.supabase_url,
        settings.supabase_service_role_key,
        options=ClientOptions(postgrest_client_timeout=20),
    )


def get_supabase_client(reset: bool = False) -> Client:
    # The Supabase Python client is not safe for our threaded request wrapper
    # when shared globally. Return a fresh client per call so concurrent
    # requests do not race through the same underlying HTTP state.
    _ = reset
    return _make_client()


_RETRIABLE = frozenset({
    "RemoteProtocolError", "ConnectionError", "ConnectError",
    "ConnectionClosed", "RemoteDisconnected", "ProtocolError",
    "WriteError", "ReadError",  # httpx/httpcore SSL EOF on stale HTTP/2 connections
    "ConnectTimeout", "ReadTimeout", "WriteTimeout", "PoolTimeout",  # TLS handshake / slow response
})


def _is_retriable(exc: BaseException) -> bool:
    seen = set()
    node: BaseException | None = exc
    while node is not None and id(node) not in seen:
        seen.add(id(node))
        if type(node).__name__ in _RETRIABLE:
            return True
        node = getattr(node, "__cause__", None) or getattr(node, "__context__", None)
    return False


def _run_with_retry(fn, *, max_attempts: int = 3, base_delay: float = 1.0):
    """Execute fn() retrying up to max_attempts times on transient connection errors."""
    last_exc: Exception | None = None
    for attempt in range(max_attempts):
        try:
            return fn()
        except Exception as exc:
            if _is_retriable(exc):
                last_exc = exc
                if attempt < max_attempts - 1:
                    time.sleep(base_delay * (attempt + 1))
                continue
            raise
    raise last_exc  # type: ignore[misc]


async def sb_select(
    table: str,
    *,
    filters: list[tuple[str, str, Any]] | None = None,
    columns: str = "*",
    order: str | None = None,
    desc: bool = False,
    limit: int | None = None,
    single: bool = False,
) -> Any:
    def _run():
        client = get_supabase_client()
        q = client.table(table).select(columns)
        for col, op, value in (filters or []):
            if op == "eq":
                q = q.eq(col, value)
            elif op == "neq":
                q = q.neq(col, value)
            elif op == "in":
                q = q.in_(col, value)
            elif op == "cs":
                q = q.contains(col, value)
        if order:
            q = q.order(order, desc=desc)
        if limit:
            q = q.limit(limit)
        res = q.execute()
        return res.data

    data = await anyio.to_thread.run_sync(lambda: _run_with_retry(_run))
    if single:
        return data[0] if data else None
    return data


async def sb_insert(table: str, payload: dict[str, Any] | list[dict[str, Any]]) -> Any:
    def _run():
        client = get_supabase_client()
        res = client.table(table).insert(payload).execute()
        return res.data

    return await anyio.to_thread.run_sync(lambda: _run_with_retry(_run))


async def sb_update(
    table: str,
    *,
    payload: dict[str, Any],
    filters: list[tuple[str, str, Any]],
) -> Any:
    def _run():
        client = get_supabase_client()
        q = client.table(table).update(payload)
        for col, op, value in filters:
            if op == "eq":
                q = q.eq(col, value)
            elif op == "neq":
                q = q.neq(col, value)
            elif op == "in":
                q = q.in_(col, value)
        res = q.execute()
        return res.data

    return await anyio.to_thread.run_sync(lambda: _run_with_retry(_run))


async def sb_rpc(fn_name: str, params: dict[str, Any]) -> Any:
    """Call a Postgres stored function (via PostgREST RPC), with the same
    transient-error retry as every other sb_* helper."""
    def _run():
        client = get_supabase_client()
        res = client.rpc(fn_name, params).execute()
        return res.data

    return await anyio.to_thread.run_sync(lambda: _run_with_retry(_run))


async def sb_delete(
    table: str,
    *,
    filters: list[tuple[str, str, Any]],
) -> Any:
    def _run():
        client = get_supabase_client()
        q = client.table(table).delete()
        for col, op, value in filters:
            if op == "eq":
                q = q.eq(col, value)
            elif op == "neq":
                q = q.neq(col, value)
            elif op == "in":
                q = q.in_(col, value)
        res = q.execute()
        return res.data

    return await anyio.to_thread.run_sync(lambda: _run_with_retry(_run))


async def sb_upsert(
    table: str,
    *,
    payload: dict[str, Any],
    on_conflict: str | None = None,
) -> Any:
    def _run():
        client = get_supabase_client()
        kwargs = {"on_conflict": on_conflict} if on_conflict else {}
        res = client.table(table).upsert(payload, **kwargs).execute()
        return res.data

    return await anyio.to_thread.run_sync(lambda: _run_with_retry(_run))
