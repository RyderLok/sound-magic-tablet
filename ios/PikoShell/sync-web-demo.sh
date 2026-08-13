#!/bin/bash
# Sync web-demo into app bundle as WebDemo/ (excludes screenshots & temp pages).
set -euo pipefail
SRC="${SRCROOT}/../../web-demo"
DST="${TARGET_BUILD_DIR}/${UNLOCALIZED_RESOURCES_FOLDER_PATH}/WebDemo"
if [[ ! -d "$SRC" ]]; then
  echo "error: web-demo not found at $SRC" >&2
  exit 1
fi
mkdir -p "$DST"
rsync -a --delete \
  --exclude '_shots/' \
  --exclude '_demo/' \
  --exclude 'brush-preview.html' \
  --exclude 'brush-preview-presets.json' \
  --exclude 'brush-stamps/' \
  --exclude '.DS_Store' \
  "$SRC/" "$DST/"
echo "Synced web-demo → $DST"
