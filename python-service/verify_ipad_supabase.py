#!/usr/bin/env python3
"""Verify iPad-compatible anon Supabase path (list / upload / download / delete).

Usage:
  export SUPABASE_URL=https://xxxx.supabase.co
  export SUPABASE_ANON_KEY=eyJ...   # Dashboard → Settings → API → anon public
  python3 verify_ipad_supabase.py

Optional: load URL from python-service/.env (never uses service_role for the test).
"""
from __future__ import annotations

import json
import os
import struct
import sys
import uuid
from pathlib import Path

try:
    import httpx
except ImportError:
    print("Install httpx: pip install httpx", file=sys.stderr)
    sys.exit(2)


def load_dotenv() -> None:
    env_path = Path(__file__).resolve().parent / ".env"
    if not env_path.is_file():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        k, v = k.strip(), v.strip().strip('"').strip("'")
        os.environ.setdefault(k, v)


def pcm_silence_wav(ms: int = 50, sr: int = 16000) -> bytes:
    n = int(sr * ms / 1000) * 2
    pcm = b"\x00" * n
    data_size = len(pcm)
    riff_size = 36 + data_size
    header = struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF",
        riff_size,
        b"WAVE",
        b"fmt ",
        16,
        1,
        1,
        sr,
        sr * 2,
        2,
        16,
        b"data",
        data_size,
    )
    return header + pcm


def main() -> int:
    load_dotenv()
    base = (os.environ.get("SUPABASE_URL") or "").rstrip("/")
    anon = (os.environ.get("SUPABASE_ANON_KEY") or "").strip()
    bucket = (os.environ.get("SUPABASE_SOUNDS_BUCKET") or "sounds").strip() or "sounds"
    if not base or not anon:
        print("Need SUPABASE_URL + SUPABASE_ANON_KEY (anon public, not service_role)", file=sys.stderr)
        return 2
    if "service_role" in anon:  # naive
        print("Refusing: key looks wrong; use anon public", file=sys.stderr)

    headers = {
        "apikey": anon,
        "Authorization": f"Bearer {anon}",
    }
    steps = []

    with httpx.Client(timeout=60.0) as client:
        # list
        r = client.get(f"{base}/rest/v1/sounds", headers={**headers, "Accept": "application/json"}, params={"select": "*", "order": "created_at.desc", "limit": "5"})
        steps.append(("list", r.status_code, r.text[:120]))
        if r.status_code >= 400:
            print(json.dumps({"ok": False, "steps": steps, "hint": "Re-run supabase_sounds.sql (SELECT policy)"}, ensure_ascii=False, indent=2))
            return 1

        sound_id = str(uuid.uuid4())
        path = f"{sound_id}.wav"
        wav = pcm_silence_wav()

        up = client.post(
            f"{base}/storage/v1/object/{bucket}/{path}",
            headers={**headers, "Content-Type": "audio/wav", "x-upsert": "true"},
            content=wav,
        )
        steps.append(("storage_upload", up.status_code, up.text[:120]))
        if up.status_code >= 400:
            print(json.dumps({"ok": False, "steps": steps, "hint": "Storage INSERT policy / bucket missing"}, ensure_ascii=False, indent=2))
            return 1

        row = {
            "id": sound_id,
            "name": "verify-ipad-supabase",
            "duration_ms": 50,
            "sample_rate": 16000,
            "upload_status": "uploaded",
            "storage_path": path,
            "source": "verify-script",
        }
        ins = client.post(
            f"{base}/rest/v1/sounds",
            headers={**headers, "Content-Type": "application/json", "Prefer": "return=representation"},
            json=row,
        )
        steps.append(("row_insert", ins.status_code, ins.text[:120]))
        if ins.status_code >= 400:
            client.delete(f"{base}/storage/v1/object/{bucket}/{path}", headers=headers)
            print(json.dumps({"ok": False, "steps": steps, "hint": "Table INSERT policy missing — run supabase_sounds.sql"}, ensure_ascii=False, indent=2))
            return 1

        dl = client.get(f"{base}/storage/v1/object/{bucket}/{path}", headers=headers)
        steps.append(("download", dl.status_code, f"bytes={len(dl.content)}"))

        client.delete(f"{base}/rest/v1/sounds?id=eq.{sound_id}", headers={**headers, "Prefer": "return=minimal"})
        client.delete(f"{base}/storage/v1/object/{bucket}/{path}", headers=headers)
        steps.append(("cleanup", 200, sound_id))

    ok = all(s[1] < 400 for s in steps if s[0] != "cleanup")
    print(json.dumps({"ok": ok, "steps": [{"step": a, "status": b, "detail": c} for a, b, c in steps]}, ensure_ascii=False, indent=2))
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
