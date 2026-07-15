#!/usr/bin/env bash
# Mac 一键启动（不覆盖 Windows .venv）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
PORT="${SERIAL_PORT:-/dev/cu.usbserial-0001}"
BAUD="${SERIAL_BAUD:-500000}"

echo "Piko — Mac bootstrap"
echo "Project: $ROOT"

test_port() {
  lsof -i ":$1" -sTCP:LISTEN >/dev/null 2>&1
}

if ! test_port 8001; then
  echo "[start] Python :8001"
  osascript -e "tell application \"Terminal\" to do script \"cd '$ROOT/python-service' && ./start-python-mac.sh\"" >/dev/null 2>&1 || {
    (cd "$ROOT/python-service" && ./start-python-mac.sh) &
  }
else
  echo "[ok] Python :8001"
fi

sleep 2

if ! test_port 8765; then
  echo "[start] Bridge :8765 ($PORT)"
  export SERIAL_PORT="$PORT" SERIAL_BAUD="$BAUD"
  osascript -e "tell application \"Terminal\" to do script \"cd '$ROOT/bridge' && ./start-bridge-mac.sh\"" >/dev/null 2>&1 || {
    (cd "$ROOT/bridge" && ./start-bridge-mac.sh) &
  }
else
  echo "[ok] Bridge :8765"
fi

sleep 1

if ! test_port 8000; then
  echo "[start] Frontend :8000"
  osascript -e "tell application \"Terminal\" to do script \"cd '$ROOT/web-demo' && python3 -m http.server 8000\"" >/dev/null 2>&1 || {
    (cd "$ROOT/web-demo" && python3 -m http.server 8000) &
  }
else
  echo "[ok] Frontend :8000"
fi

sleep 2
open "http://localhost:8000" 2>/dev/null || true
echo "Open: http://localhost:8000"
open "http://localhost:8000" 2>/dev/null || true
echo "Open: http://localhost:8000"
