#!/usr/bin/env bash
# Install / uninstall LaunchAgent so Python :8001 stays running at login (Mac).
# macOS TCC blocks launchd from reading Desktop project paths.
# Solution: mirror *.py + .env into ~/Library/Application Support/Piko/python-runtime
# and run Library venv-mac from there.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="com.piko.python"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
SUPPORT="$HOME/Library/Application Support/Piko"
VENV="$SUPPORT/venv-mac"
PY="$VENV/bin/python"
SRC="$ROOT/python-service"
RUNTIME="$SUPPORT/python-runtime"
LOG_DIR="${TMPDIR:-/tmp}/piko-python"
REQ="$SRC/requirements.txt"

usage() {
  echo "Usage: $0 [install|uninstall|status|sync]"
  exit 1
}

cmd="${1:-install}"

sync_runtime() {
  mkdir -p "$RUNTIME/sounds" "$LOG_DIR"
  cp -f "$SRC"/*.py "$RUNTIME/"
  if [ -f "$SRC/.env" ]; then cp -f "$SRC/.env" "$RUNTIME/.env"; fi
  if [ -f "$SRC/.env.example" ]; then cp -f "$SRC/.env.example" "$RUNTIME/.env.example"; fi
  echo "[sync] $SRC → $RUNTIME"
}

ensure_venv() {
  mkdir -p "$SUPPORT"
  if [ ! -x "$PY" ]; then
    echo "[setup] creating Library venv at $VENV"
    /usr/bin/python3 -m venv "$VENV"
    "$VENV/bin/pip" install -U pip
    "$VENV/bin/pip" install -r "$REQ"
  fi
  "$PY" -c "import uvicorn,fastapi" >/dev/null
}

uninstall() {
  launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true
  launchctl unload "$PLIST" 2>/dev/null || true
  rm -f "$PLIST"
  echo "[ok] removed $PLIST"
}

install() {
  ensure_venv
  sync_runtime
  mkdir -p "$HOME/Library/LaunchAgents"

  cat >"$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${PY}</string>
    <string>-m</string>
    <string>uvicorn</string>
    <string>app:app</string>
    <string>--host</string>
    <string>127.0.0.1</string>
    <string>--port</string>
    <string>8001</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${RUNTIME}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>3</integer>
  <key>StandardOutPath</key>
  <string>${LOG_DIR}/python.log</string>
  <key>StandardErrorPath</key>
  <string>${LOG_DIR}/python.err.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin</string>
  </dict>
</dict>
</plist>
EOF

  pkill -f "uvicorn app:app --host 127.0.0.1 --port 8001" 2>/dev/null || true
  sleep 1
  : >"$LOG_DIR/python.err.log" 2>/dev/null || true

  launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$PLIST"
  launchctl enable "gui/$(id -u)/${LABEL}" 2>/dev/null || true
  launchctl kickstart -k "gui/$(id -u)/${LABEL}" 2>/dev/null || true
  sleep 2

  echo "[ok] installed $PLIST"
  echo "     runtime: $RUNTIME"
  echo "     After editing python-service/*.py run: $0 sync && $0 install"
  echo "     Uninstall: $0 uninstall"
  "$0" status || true
}

status() {
  if [ -f "$PLIST" ]; then echo "[plist] $PLIST"; else echo "[plist] not installed"; fi
  launchctl print "gui/$(id -u)/${LABEL}" 2>/dev/null | head -n 24 || echo "[launchd] not loaded"
  echo "[health]"
  curl -sS "http://127.0.0.1:8001/health" 2>/dev/null | head -c 220 || echo "python down"
  echo
  echo "[err tail]"
  tail -n 6 "$LOG_DIR/python.err.log" 2>/dev/null || true
}

case "$cmd" in
  install) install ;;
  uninstall) uninstall ;;
  status) status ;;
  sync) sync_runtime ;;
  *) usage ;;
esac
