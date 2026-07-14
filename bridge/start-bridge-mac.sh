#!/usr/bin/env bash
# Mac-only launcher — uses Node from ~/.local, does not change Windows COM3 defaults in code
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
NODE_DIR="${NODE_DIR:-$HOME/.local/node-v20.19.2-darwin-arm64}"
NODE="$NODE_DIR/bin/node"
PORT="${SERIAL_PORT:-/dev/cu.usbserial-0001}"
BAUD="${SERIAL_BAUD:-500000}"
WS_PORT="${WS_PORT:-8765}"

if [ ! -x "$NODE" ]; then
  echo "Node not found at $NODE"
  echo "Install once (outside project):"
  echo "  mkdir -p ~/.local && curl -fsSL https://nodejs.org/dist/v20.19.2/node-v20.19.2-darwin-arm64.tar.xz | tar -xJ -C ~/.local"
  exit 1
fi

cd "$ROOT"
# Remove macOS quarantine on Windows-copied native modules (no npm rebuild needed)
xattr -cr node_modules/@serialport 2>/dev/null || true

echo "Bridge: $PORT @ $BAUD → ws://127.0.0.1:$WS_PORT"
exec "$NODE" serial-bridge.js --port "$PORT" --baud "$BAUD" --ws "$WS_PORT"
