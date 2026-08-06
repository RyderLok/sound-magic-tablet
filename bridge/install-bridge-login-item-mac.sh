#!/usr/bin/env bash
# Install / uninstall LaunchAgent so Bridge stays running at login (Mac).
# LaunchAgent runs node serial-bridge.js in the FOREGROUND with KeepAlive.
# (Background nohup from a short-lived LaunchAgent gets killed by launchd.)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="com.piko.bridge"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
SUPPORT="$HOME/Library/Application Support/Piko"
LOG_DIR="${TMPDIR:-/tmp}/piko-bridge"
BRIDGE_DIR="$ROOT/bridge"

usage() {
  echo "Usage: $0 [install|uninstall|status|run-once]"
  exit 1
}

cmd="${1:-install}"

resolve_node() {
  if [ -n "${NODE_BIN:-}" ] && [ -x "$NODE_BIN" ]; then
    echo "$NODE_BIN"
    return
  fi
  local cand
  for cand in \
    "$HOME/.local/node-v20.19.2-darwin-arm64/bin/node" \
    "$HOME/.local/node-v20.18.0-darwin-arm64/bin/node" \
    /opt/homebrew/bin/node \
    /usr/local/bin/node
  do
    if [ -x "$cand" ]; then
      echo "$cand"
      return
    fi
  done
  if command -v node >/dev/null 2>&1; then
    command -v node
    return
  fi
  echo ""
}

uninstall() {
  launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true
  launchctl unload "$PLIST" 2>/dev/null || true
  rm -f "$PLIST"
  echo "[ok] removed $PLIST"
}

install() {
  local node_bin
  node_bin="$(resolve_node)"
  if [ -z "$node_bin" ]; then
    echo "[err] node not found — install Node or set NODE_BIN"
    exit 1
  fi
  mkdir -p "$HOME/Library/LaunchAgents" "$LOG_DIR" "$SUPPORT"

  # Optional helper for Terminal / Agent (not used by launchd).
  cat >"$SUPPORT/run-bridge-keepalive.sh" <<EOF
#!/bin/bash
# Manual keepalive — prefer LaunchAgent (com.piko.bridge) for persistence.
set -euo pipefail
if /usr/sbin/lsof -nP -iTCP:8765 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "[ok] Bridge already on :8765"
  curl -sS "http://127.0.0.1:8766/health" 2>/dev/null | head -c 280 || true
  echo
  exit 0
fi
cd "$BRIDGE_DIR"
/usr/bin/xattr -cr node_modules/@serialport 2>/dev/null || true
export SERIAL_PORT="\${SERIAL_PORT:-auto}" SERIAL_BAUD="\${SERIAL_BAUD:-500000}"
nohup "$node_bin" serial-bridge.js --port "\$SERIAL_PORT" --baud "\$SERIAL_BAUD" --ws 8765 >>"$LOG_DIR/bridge.log" 2>&1 &
echo \$! >"$LOG_DIR/bridge.pid"
sleep 2
if /usr/sbin/lsof -nP -iTCP:8765 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "[ok] Bridge started"
  curl -sS "http://127.0.0.1:8766/health" 2>/dev/null | head -c 280 || true
  echo
else
  echo "[warn] Bridge did not listen — see $LOG_DIR/bridge.log"
  exit 1
fi
EOF
  chmod +x "$SUPPORT/run-bridge-keepalive.sh"

  cat >"$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${node_bin}</string>
    <string>${BRIDGE_DIR}/serial-bridge.js</string>
    <string>--port</string>
    <string>auto</string>
    <string>--baud</string>
    <string>500000</string>
    <string>--ws</string>
    <string>8765</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${BRIDGE_DIR}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>3</integer>
  <key>StandardOutPath</key>
  <string>${LOG_DIR}/bridge.log</string>
  <key>StandardErrorPath</key>
  <string>${LOG_DIR}/bridge.err.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>SERIAL_PORT</key>
    <string>auto</string>
    <key>SERIAL_BAUD</key>
    <string>500000</string>
    <key>PATH</key>
    <string>/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin:$(dirname "$node_bin")</string>
  </dict>
</dict>
</plist>
EOF

  # Stop any stray manual bridge so LaunchAgent owns the port.
  pkill -f "serial-bridge.js" 2>/dev/null || true
  sleep 1

  : >"$LOG_DIR/launchd.err.log" 2>/dev/null || true
  launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$PLIST"
  launchctl enable "gui/$(id -u)/${LABEL}" 2>/dev/null || true
  launchctl kickstart -k "gui/$(id -u)/${LABEL}" 2>/dev/null || true
  sleep 2

  echo "[ok] installed $PLIST"
  echo "     LaunchAgent runs node in foreground + KeepAlive"
  echo "     Uninstall: $0 uninstall"
  "$0" status || true
}

status() {
  if [ -f "$PLIST" ]; then
    echo "[plist] $PLIST"
  else
    echo "[plist] not installed"
  fi
  launchctl print "gui/$(id -u)/${LABEL}" 2>/dev/null | head -n 30 || echo "[launchd] not loaded"
  echo "[health]"
  curl -sS "http://127.0.0.1:8766/health" 2>/dev/null | head -c 320 || echo "bridge down"
  echo
  ls /dev/cu.usb* 2>/dev/null || echo "[usb] none"
}

run_once() {
  /bin/bash "$SUPPORT/run-bridge-keepalive.sh"
}

case "$cmd" in
  install) install ;;
  uninstall) uninstall ;;
  status) status ;;
  run-once) run_once ;;
  *) usage ;;
esac
