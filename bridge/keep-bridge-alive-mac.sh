#!/usr/bin/env bash
# Keep Bridge running in background on Mac (USB auto-detect).
# Usage: ./bridge/keep-bridge-alive-mac.sh
# Note: LaunchAgent must use install-bridge-login-item-mac.sh (Library wrapper).
# Do not point launchd at this Desktop script — macOS TCC blocks it.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BRIDGE="$ROOT/bridge"
LOG_DIR="${TMPDIR:-/tmp}/piko-bridge"
LOG="$LOG_DIR/bridge.log"
PID_FILE="$LOG_DIR/bridge.pid"
mkdir -p "$LOG_DIR"

is_listening() {
  lsof -nP -iTCP:8765 -sTCP:LISTEN >/dev/null 2>&1
}

if is_listening; then
  echo "[ok] Bridge already listening on :8765"
  curl -sS "http://127.0.0.1:8766/health" 2>/dev/null | head -c 300 || true
  echo
  exit 0
fi

export SERIAL_PORT="${SERIAL_PORT:-auto}"
export SERIAL_BAUD="${SERIAL_BAUD:-500000}"

# Prefer Library wrapper path when present (same as LaunchAgent).
WRAPPER="$HOME/Library/Application Support/Piko/run-bridge-keepalive.sh"
if [ -x "$WRAPPER" ]; then
  echo "[start] via Library wrapper"
  exec /bin/bash "$WRAPPER"
fi

echo "[start] Bridge background (SERIAL_PORT=$SERIAL_PORT)"
nohup "$BRIDGE/start-bridge-mac.sh" >>"$LOG" 2>&1 &
echo $! >"$PID_FILE"
sleep 1
if is_listening; then
  echo "[ok] Bridge up — log: $LOG"
  curl -sS "http://127.0.0.1:8766/health" 2>/dev/null | head -c 300 || true
  echo
else
  echo "[warn] Bridge may still be starting — check $LOG"
  tail -n 20 "$LOG" 2>/dev/null || true
fi
