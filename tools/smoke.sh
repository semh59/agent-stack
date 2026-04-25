#!/usr/bin/env bash
# Boot the bridge in the background, run the smoke suite against it, tear down.
# Exit code is the smoke suite's exit code.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT/bridge"

: "${ALLOY_BRIDGE_SECRET:=smoke-test-$(openssl rand -hex 16 2>/dev/null || echo "smoke-static")}"
export ALLOY_BRIDGE_SECRET
export APP_ENV=development
export PYTHONPATH="$ROOT/bridge"

echo "[smoke] starting bridge on 127.0.0.1:9100..."
python3 bridge.py --port 9100 --host 127.0.0.1 >/tmp/bridge.log 2>&1 &
BRIDGE_PID=$!

cleanup() {
  if kill -0 "$BRIDGE_PID" 2>/dev/null; then
    kill "$BRIDGE_PID" 2>/dev/null || true
    wait "$BRIDGE_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

echo "[smoke] running suite..."
python3 "$ROOT/scripts/smoke_test.py" --url http://127.0.0.1:9100 --wait 30
RC=$?

if [ "$RC" -ne 0 ]; then
  echo "[smoke] bridge log (tail):"
  tail -n 50 /tmp/bridge.log || true
fi

exit "$RC"
