#!/usr/bin/env bash
# Mac-only launcher — does not touch Windows .venv or start-python.ps1
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
PY="$ROOT/.venv-mac/bin/python"

if [ ! -x "$PY" ]; then
  echo "Mac venv not found. Run once:"
  echo "  cd python-service"
  echo "  python3 -m venv .venv-mac"
  echo "  .venv-mac/bin/pip install -r requirements.txt"
  exit 1
fi

cd "$ROOT"
HOST="${HOST:-0.0.0.0}"
PORT="${PORT:-8001}"
echo "Starting Python service on http://${HOST}:${PORT} (0.0.0.0 = reachable from phone hotspot / LAN)"
exec "$PY" -m uvicorn app:app --host "$HOST" --port "$PORT"
