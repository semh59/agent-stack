#!/usr/bin/env python3
"""
End-to-end smoke test.

Boots the bridge (or connects to a running one) and hits every endpoint with
the expected contract. Exits 0 on full pass, non-zero with a summary on any
failure.

Usage (assumes bridge is already running locally):
  export ALLOY_BRIDGE_SECRET=...
  python3 scripts/smoke_test.py --url http://127.0.0.1:9100

Or let it launch a bridge for you (dev only):
  python3 scripts/smoke_test.py --launch

In CI this is wrapped by scripts/smoke.sh so the whole stack is started and
torn down automatically.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Any


@dataclass
class Case:
    name: str
    method: str
    path: str
    body: dict | None = None
    expect_status: int = 200
    expect_keys: list[str] = field(default_factory=list)
    auth: bool = True


def _call(url: str, method: str, path: str, secret: str, body: dict | None) -> tuple[int, Any, dict]:
    data = None
    headers = {"Accept": "application/json"}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    if secret:
        headers["X-Bridge-Secret"] = secret
    headers["X-Request-ID"] = f"smoke_{int(time.time() * 1000)}"

    req = urllib.request.Request(
        f"{url}{path}", data=data, method=method, headers=headers
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            raw = r.read().decode("utf-8")
            return r.status, (json.loads(raw) if raw else {}), dict(r.headers)
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8")
        return e.code, (json.loads(raw) if raw else {}), dict(e.headers)
    except Exception as e:
        return -1, {"error": f"{type(e).__name__}: {e}"}, {}


def run_suite(url: str, secret: str) -> int:
    cases: list[Case] = [
        Case("health is unauth", "GET", "/health", expect_keys=["status", "timestamp"], auth=False),
        Case("ready", "GET", "/ready", expect_keys=["ready"], auth=False),
        Case("auth required on /status", "GET", "/status", expect_status=401, auth=False),
        Case("status OK with secret", "GET", "/status"),
        Case("cache-stats", "GET", "/cache-stats"),
        Case("optimize empty → 400", "POST", "/optimize", body={}, expect_status=400),
        Case(
            "optimize happy path",
            "POST",
            "/optimize",
            body={"message": "smoke-test hello world"},
            expect_keys=["optimized", "tokens", "savings_percent"],
        ),
        Case(
            "cache-clear all",
            "POST",
            "/cache-clear",
            body={"tier": "all"},
            expect_keys=["cleared"],
        ),
        Case(
            "cost-report today",
            "GET",
            "/cost-report?period=today",
        ),
    ]

    failures: list[str] = []
    last_rid = None
    for case in cases:
        sec = secret if case.auth else ""
        status, body, headers = _call(url, case.method, case.path, sec, case.body)
        rid = headers.get("X-Request-ID") or headers.get("x-request-id")
        if rid:
            last_rid = rid
        ok = status == case.expect_status
        missing = [k for k in case.expect_keys if isinstance(body, dict) and k not in body] if ok else []
        if not ok or missing:
            failures.append(
                f"  ✗ {case.name}\n"
                f"     url={case.method} {case.path} expected_status={case.expect_status} got={status}\n"
                f"     missing_keys={missing}\n"
                f"     body={json.dumps(body)[:300]}\n"
                f"     request_id={rid}"
            )
            print(f"  ✗ {case.name} (status={status}, rid={rid})")
        else:
            print(f"  ✓ {case.name} (status={status}, rid={rid})")

    print("")
    print(f"Total: {len(cases)}  Passed: {len(cases) - len(failures)}  Failed: {len(failures)}")
    if failures:
        print("\nFailures:")
        for f in failures:
            print(f)
        return 1
    print(f"\n✅ All smoke checks passed. last_request_id={last_rid}")
    return 0


def wait_for_health(url: str, timeout: float = 30.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(f"{url}/health", timeout=2) as r:
                if r.status == 200:
                    return True
        except Exception:
            time.sleep(0.5)
    return False


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=os.environ.get("BRIDGE_URL", "http://127.0.0.1:9100"))
    ap.add_argument("--secret", default=os.environ.get("ALLOY_BRIDGE_SECRET", ""))
    ap.add_argument("--wait", type=float, default=30.0, help="Seconds to wait for /health")
    args = ap.parse_args()

    if not args.secret:
        print("error: ALLOY_BRIDGE_SECRET is required", file=sys.stderr)
        return 2

    print(f"Smoke test → {args.url}")
    if not wait_for_health(args.url, args.wait):
        print(f"error: {args.url}/health never returned 200", file=sys.stderr)
        return 3

    return run_suite(args.url, args.secret)


if __name__ == "__main__":
    sys.exit(main())
