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
echo "Starting Python service on http://127.0.0.1:8001"
exec "$PY" -m uvicorn app:app --host 127.0.0.1 --port 8001
