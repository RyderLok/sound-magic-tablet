"""Sounds persistence — Supabase (preferred) or local disk fallback."""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import config

try:
    import httpx
except ImportError:  # pragma: no cover
    httpx = None  # type: ignore


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _rest_headers() -> Dict[str, str]:
    return {
        "apikey": config.SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {config.SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }


def status() -> Dict[str, Any]:
    return {
        "configured": config.supabase_configured(),
        "bucket": config.SUPABASE_SOUNDS_BUCKET,
        "backend": "supabase" if config.supabase_configured() else "local",
    }


def _load_local_index() -> List[Dict[str, Any]]:
    path = config.LOCAL_SOUNDS_INDEX
    if not path.is_file():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except (OSError, json.JSONDecodeError):
        return []


def _save_local_index(rows: List[Dict[str, Any]]) -> None:
    config.LOCAL_SOUNDS_DIR.mkdir(parents=True, exist_ok=True)
    config.LOCAL_SOUNDS_INDEX.write_text(
        json.dumps(rows, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def _next_local_name(rows: List[Dict[str, Any]]) -> str:
    return f"sound{len(rows) + 1}"


async def upload_sound(
    wav_bytes: bytes,
    *,
    name: Optional[str] = None,
    duration_ms: int = 0,
    sample_rate: int = 16000,
    source: str = "esp32",
) -> Dict[str, Any]:
    if config.supabase_configured():
        return await _upload_supabase(
            wav_bytes,
            name=name,
            duration_ms=duration_ms,
            sample_rate=sample_rate,
            source=source,
        )
    return _upload_local(
        wav_bytes,
        name=name,
        duration_ms=duration_ms,
        sample_rate=sample_rate,
        source=source,
    )


def _upload_local(
    wav_bytes: bytes,
    *,
    name: Optional[str],
    duration_ms: int,
    sample_rate: int,
    source: str,
) -> Dict[str, Any]:
    rows = _load_local_index()
    sound_id = str(uuid.uuid4())
    display = (name or "").strip() or _next_local_name(rows)
    rel = f"{sound_id}.wav"
    path = config.LOCAL_SOUNDS_DIR / rel
    path.write_bytes(wav_bytes)
    row = {
        "id": sound_id,
        "created_at": _now_iso(),
        "name": display,
        "duration_ms": int(duration_ms or 0),
        "sample_rate": int(sample_rate or 16000),
        "upload_status": "uploaded",
        "storage_path": rel,
        "source": source or "esp32",
        "analysis": None,
        "brush": None,
    }
    rows.insert(0, row)
    _save_local_index(rows)
    return row


async def _upload_supabase(
    wav_bytes: bytes,
    *,
    name: Optional[str],
    duration_ms: int,
    sample_rate: int,
    source: str,
) -> Dict[str, Any]:
    if httpx is None:
        raise RuntimeError("httpx is required for Supabase uploads")

    sound_id = str(uuid.uuid4())
    display = (name or "").strip() or f"sound-{sound_id[:8]}"
    storage_path = f"{sound_id}.wav"
    bucket = config.SUPABASE_SOUNDS_BUCKET
    base = config.SUPABASE_URL

    async with httpx.AsyncClient(timeout=60.0) as client:
        up = await client.post(
            f"{base}/storage/v1/object/{bucket}/{storage_path}",
            headers={
                "apikey": config.SUPABASE_SERVICE_ROLE_KEY,
                "Authorization": f"Bearer {config.SUPABASE_SERVICE_ROLE_KEY}",
                "Content-Type": "audio/wav",
                "x-upsert": "true",
            },
            content=wav_bytes,
        )
        if up.status_code >= 400:
            raise RuntimeError(f"Supabase storage upload failed: {up.status_code} {up.text[:200]}")

        existing = await list_sounds()
        if not (name or "").strip():
            display = f"sound{len(existing) + 1}"

        row = {
            "id": sound_id,
            "name": display,
            "duration_ms": int(duration_ms or 0),
            "sample_rate": int(sample_rate or 16000),
            "upload_status": "uploaded",
            "storage_path": storage_path,
            "source": source or "esp32",
            "analysis": None,
            "brush": None,
        }
        ins = await client.post(
            f"{base}/rest/v1/sounds",
            headers=_rest_headers(),
            json=row,
        )
        if ins.status_code >= 400:
            raise RuntimeError(f"Supabase insert failed: {ins.status_code} {ins.text[:200]}")
        data = ins.json()
        if isinstance(data, list) and data:
            return data[0]
        if isinstance(data, dict):
            return data
        return row


async def list_sounds() -> List[Dict[str, Any]]:
    if config.supabase_configured():
        return await _list_supabase()
    return _load_local_index()


async def _list_supabase() -> List[Dict[str, Any]]:
    if httpx is None:
        raise RuntimeError("httpx is required for Supabase")
    async with httpx.AsyncClient(timeout=30.0) as client:
        res = await client.get(
            f"{config.SUPABASE_URL}/rest/v1/sounds",
            headers=_rest_headers(),
            params={"select": "*", "order": "created_at.desc"},
        )
        if res.status_code >= 400:
            raise RuntimeError(f"Supabase list failed: {res.status_code} {res.text[:200]}")
        data = res.json()
        return data if isinstance(data, list) else []


async def get_sound(sound_id: str) -> Optional[Dict[str, Any]]:
    if config.supabase_configured():
        return await _get_supabase(sound_id)
    for row in _load_local_index():
        if row.get("id") == sound_id:
            return row
    return None


async def _get_supabase(sound_id: str) -> Optional[Dict[str, Any]]:
    if httpx is None:
        raise RuntimeError("httpx is required for Supabase")
    async with httpx.AsyncClient(timeout=30.0) as client:
        res = await client.get(
            f"{config.SUPABASE_URL}/rest/v1/sounds",
            headers=_rest_headers(),
            params={"id": f"eq.{sound_id}", "select": "*"},
        )
        if res.status_code >= 400:
            raise RuntimeError(f"Supabase get failed: {res.status_code}")
        data = res.json()
        if isinstance(data, list) and data:
            return data[0]
        return None


async def read_audio_bytes(sound_id: str) -> Optional[bytes]:
    row = await get_sound(sound_id)
    if not row:
        return None
    storage_path = row.get("storage_path") or ""
    if not storage_path:
        return None

    if config.supabase_configured():
        if httpx is None:
            raise RuntimeError("httpx is required for Supabase")
        bucket = config.SUPABASE_SOUNDS_BUCKET
        async with httpx.AsyncClient(timeout=60.0) as client:
            res = await client.get(
                f"{config.SUPABASE_URL}/storage/v1/object/{bucket}/{storage_path}",
                headers={
                    "apikey": config.SUPABASE_SERVICE_ROLE_KEY,
                    "Authorization": f"Bearer {config.SUPABASE_SERVICE_ROLE_KEY}",
                },
            )
            if res.status_code >= 400:
                return None
            return res.content

    path = config.LOCAL_SOUNDS_DIR / Path(storage_path).name
    if not path.is_file():
        return None
    return path.read_bytes()


async def patch_sound(sound_id: str, fields: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    allowed = {k: fields[k] for k in ("name", "analysis", "brush", "upload_status") if k in fields}
    if not allowed:
        return await get_sound(sound_id)

    if config.supabase_configured():
        if httpx is None:
            raise RuntimeError("httpx is required for Supabase")
        async with httpx.AsyncClient(timeout=30.0) as client:
            res = await client.patch(
                f"{config.SUPABASE_URL}/rest/v1/sounds",
                headers=_rest_headers(),
                params={"id": f"eq.{sound_id}"},
                json=allowed,
            )
            if res.status_code >= 400:
                raise RuntimeError(f"Supabase patch failed: {res.status_code} {res.text[:200]}")
            data = res.json()
            if isinstance(data, list) and data:
                return data[0]
            return await get_sound(sound_id)

    rows = _load_local_index()
    for i, row in enumerate(rows):
        if row.get("id") == sound_id:
            rows[i] = {**row, **allowed}
            _save_local_index(rows)
            return rows[i]
    return None
