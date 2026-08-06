#!/usr/bin/env bash
# Mac-only launcher — auto-detect USB serial (ESP32) by default.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
NODE_DIR="${NODE_DIR:-$HOME/.local/node-v20.19.2-darwin-arm64}"
NODE="$NODE_DIR/bin/node"
# auto = poll /dev/cu.usbserial-* etc. Override with SERIAL_PORT=/dev/cu.xxx if needed.
PORT="${SERIAL_PORT:-auto}"
BAUD="${SERIAL_BAUD:-500000}"
WS_PORT="${WS_PORT:-8765}"

if [ ! -x "$NODE" ]; then
  if command -v node >/dev/null 2>&1; then
    NODE="$(command -v node)"
  else
    echo "Node not found at $NODE"
    echo "Install once (outside project):"
    echo "  mkdir -p ~/.local && curl -fsSL https://nodejs.org/dist/v20.19.2/node-v20.19.2-darwin-arm64.tar.xz | tar -xJ -C ~/.local"
    exit 1
  fi
fi

cd "$ROOT"
# Remove macOS quarantine on Windows-copied native modules (no npm rebuild needed)
xattr -cr node_modules/@serialport 2>/dev/null || true

echo "Bridge: port=$PORT @ $BAUD → ws://127.0.0.1:$WS_PORT"
exec "$NODE" serial-bridge.js --port "$PORT" --baud "$BAUD" --ws "$WS_PORT"
