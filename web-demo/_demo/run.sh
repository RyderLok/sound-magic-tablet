#!/usr/bin/env bash
# Temporary demo launcher — does not patch product source.
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"
if [[ ! -d node_modules/puppeteer-core ]]; then
  npm install puppeteer-core@23 --silent
fi
exec node "$DIR/run-flow-demo.mjs"
