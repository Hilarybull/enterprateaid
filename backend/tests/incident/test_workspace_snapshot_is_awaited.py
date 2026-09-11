"""
Incident regression test (data-integrity / snapshot safety net).

Guards against the original bug: the pre-write MongoDB snapshot was scheduled
with `asyncio.create_task(...)` and never awaited, so the request handler
could return (and the orphan task be dropped) before it ran. In production
this meant the snapshot safety net fired ~once ever.

`_snapshot_before_write` must now:
  1. actually run to completion before returning (it is awaited), and
  2. be bounded by SNAPSHOT_TIMEOUT_SECONDS so a slow/unreachable Mongo can
     delay a save by at most that long, never hang it.

No pytest dependency:
    cd backend && python -m tests.incident.test_workspace_snapshot_is_awaited
"""
from __future__ import annotations

import asyncio
import sys
import time

from app.modules.idea_validation import service as iv


def main() -> int:
    failures: list[str] = []
    orig = iv._save_snapshot_to_mongo

    # 1. A normal (fast) snapshot call must complete and actually run the save
    #    function to completion — not be dropped.
    ran = {"done": False}

    async def fast_save(workspace_id, workspace_name, data, now_iso):
        await asyncio.sleep(0)
        ran["done"] = True
        return True

    iv._save_snapshot_to_mongo = fast_save
    try:
        asyncio.run(iv._snapshot_before_write("w1", "Test", {"k": "v"}))
    finally:
        iv._save_snapshot_to_mongo = orig
    if not ran["done"]:
        failures.append(
            "REGRESSION: _snapshot_before_write returned without the underlying "
            "save completing — it is not actually being awaited."
        )

    # 2. A slow / hanging Mongo must not hang the caller beyond the timeout,
    #    and _snapshot_before_write itself must not raise.
    async def hanging_save(workspace_id, workspace_name, data, now_iso):
        await asyncio.sleep(9999)
        return True

    async def timed_call():
        t0 = time.monotonic()
        await asyncio.wait_for(
            iv._snapshot_before_write("w2", "Test", {"k": "v"}),
            timeout=iv.SNAPSHOT_TIMEOUT_SECONDS + 2,  # outer safety margin only
        )
        return time.monotonic() - t0

    iv._save_snapshot_to_mongo = hanging_save
    try:
        elapsed = asyncio.run(timed_call())
    except asyncio.TimeoutError:
        failures.append(
            f"REGRESSION: a hanging snapshot blocked the caller past "
            f"SNAPSHOT_TIMEOUT_SECONDS + margin ({iv.SNAPSHOT_TIMEOUT_SECONDS + 2}s)."
        )
        elapsed = None
    finally:
        iv._save_snapshot_to_mongo = orig

    if elapsed is not None and elapsed > iv.SNAPSHOT_TIMEOUT_SECONDS + 1:
        failures.append(
            f"snapshot took {elapsed:.1f}s, expected to be cut off around "
            f"SNAPSHOT_TIMEOUT_SECONDS={iv.SNAPSHOT_TIMEOUT_SECONDS}s"
        )

    if failures:
        print("FAIL:")
        for f in failures:
            print("  -", f)
        return 1
    print("PASS: workspace snapshot is awaited and time-bounded (2/2 cases).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
