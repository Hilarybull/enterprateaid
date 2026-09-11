"""
Incident regression test (data-integrity / F1).

Guards: POST /auth/demo -> _ensure_demo_workspace() must NEVER overwrite an
existing demo workspace's `data`. It may only:
  - INSERT a workspace when none exists, or
  - re-seed a workspace whose data is null/empty (recovery only).

No pytest dependency — run directly:
    cd backend && python -m tests.incident.test_demo_workspace_not_overwritten
Exit code 0 = pass.
"""
from __future__ import annotations

import asyncio
import sys

from app.shared.auth import router as auth_router


class _Recorder:
    def __init__(self, select_result):
        self._select_result = select_result
        self.select_calls: list[tuple] = []
        self.insert_calls: list[tuple] = []
        self.update_calls: list[tuple] = []

    async def sb_select(self, table, **kwargs):
        self.select_calls.append((table, kwargs))
        if table == "workspaces":
            return self._select_result
        return None  # user_subscriptions etc.

    async def sb_insert(self, table, payload):
        self.insert_calls.append((table, payload))
        return [payload]

    async def sb_update(self, table, *, payload, filters):
        self.update_calls.append((table, payload, filters))
        return [payload]


def _run(select_result):
    rec = _Recorder(select_result)
    orig = (auth_router.sb_select, auth_router.sb_insert, auth_router.sb_update)
    auth_router.sb_select, auth_router.sb_insert, auth_router.sb_update = (
        rec.sb_select, rec.sb_insert, rec.sb_update,
    )
    try:
        asyncio.run(auth_router._ensure_demo_workspace("demo@enterprate.ai"))
    finally:
        auth_router.sb_select, auth_router.sb_insert, auth_router.sb_update = orig
    return rec


def _ws_writes(rec):
    """(inserts, data-bearing updates) against the workspaces table."""
    inserts = [p for (t, p) in rec.insert_calls if t == "workspaces"]
    updates = [
        (p, f) for (t, p, f) in rec.update_calls
        if t == "workspaces" and "data" in p
    ]
    return inserts, updates


def main() -> int:
    failures: list[str] = []

    # 1. Existing workspace WITH data -> nothing is written to workspaces. (F1 guard)
    rec = _run({"id": "w1", "user_id": "demo@enterprate.ai",
                "data": {"financials": {"invoices": [{"id": "real-1"}]},
                         "idea_validation": {"x": 1}}})
    ins, upd = _ws_writes(rec)
    if ins or upd:
        failures.append(
            f"REGRESSION: demo login wrote to a populated demo workspace "
            f"(inserts={len(ins)}, data-updates={len(upd)})"
        )

    # 2. No workspace -> exactly one INSERT, no data-update.
    rec = _run(None)
    ins, upd = _ws_writes(rec)
    if len(ins) != 1 or upd:
        failures.append(f"expected 1 insert / 0 updates when absent; got {len(ins)}/{len(upd)}")

    # 3. Existing workspace with EMPTY data -> exactly one re-seed update, no insert.
    for empty in ({}, None):
        rec = _run({"id": "w1", "user_id": "demo@enterprate.ai", "data": empty})
        ins, upd = _ws_writes(rec)
        if ins or len(upd) != 1:
            failures.append(
                f"expected 1 re-seed update / 0 inserts for empty data={empty!r}; "
                f"got {len(ins)}/{len(upd)}"
            )

    if failures:
        print("FAIL:")
        for f in failures:
            print("  -", f)
        return 1
    print("PASS: demo workspace is never overwritten on login (3 cases).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
