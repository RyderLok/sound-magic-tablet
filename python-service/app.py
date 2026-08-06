"""FastAPI + WebSocket — real-time (Mode A) and full WAV (Mode B) analysis."""
from __future__ import annotations

import asyncio
import json
import time
from pathlib import Path
from typing import Any, Dict

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

import config
from audio_analyzer import analyze_pcm_frame, analyze_wav_bytes
from feature_normalizer import EmaSmoother
from schemas import (
    AnalysisResultMessage,
    AudioFeatures,
    AudioFrameMessage,
    BrushParams,
    FullAnalysisResponse,
    SemanticAnalysis,
    SemanticError,
    VisualModifiers,
)
from visual_mapper import features_to_modifiers, modifiers_to_brush
import sounds_store

app = FastAPI(title="Piko Python Enhancement", version="1.0.0")
smoother = EmaSmoother(alpha=0.28)

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS + ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def _on_startup() -> None:
    config.write_local_sounds_pointer()
    st = sounds_store.status()
    print(
        "[sounds]",
        f"backend={st.get('backend')}",
        f"configured={st.get('configured')}",
        f"localDir={st.get('localDir')}",
        f"localCount={st.get('localCount')}",
        flush=True,
    )
    if not st.get("configured"):
        print("[sounds]", st.get("hint"), flush=True)


@app.get("/health")
def health(request: Request) -> Dict[str, Any]:
    public = (config.PUBLIC_BASE_URL or "").rstrip("/")
    if not public:
        # Prefer the URL the client actually used (works behind tunnels / cloud hosts).
        public = str(request.base_url).rstrip("/")
    if public.startswith("https://"):
        ws_base = "wss://" + public[len("https://") :]
    elif public.startswith("http://"):
        ws_base = "ws://" + public[len("http://") :]
    else:
        public = f"http://127.0.0.1:{config.PORT}"
        ws_base = f"ws://127.0.0.1:{config.PORT}"
    ws = f"{ws_base}{config.WS_AUDIO_PATH}"
    omni = {"configured": False}
    try:
        from siliconflow_omni import status as omni_status

        omni = omni_status()
    except Exception:
        pass
    return {
        "status": "ok",
        "http": public,
        "ws": ws,
        "endpoints": {
            "health": f"{public}/health",
            "analyzeWav": f"{public}/analyze/wav",
            "soundsUpload": f"{public}/sounds/upload",
            "soundsUploadPcm": f"{public}/sounds/upload_pcm",
            "soundsList": f"{public}/sounds",
            "wsAudio": ws,
        },
        "librosa": _librosa_flag(),
        "sampleRate": config.SAMPLE_RATE,
        "analysisHz": config.ANALYSIS_TARGET_HZ,
        "omni": omni,
        "supabase": sounds_store.status(),
        "wifiUpload": {
            "path": "/sounds/upload_pcm",
            "hint": "ESP32 STA POST raw PCM16 LE; bind HOST=0.0.0.0 for hotspot/LAN",
        },
        "pipeline": [
            "WAV",
            "waveform",
            "spectrum",
            "spectrogram",
            "features",
            "brush",
            "semantic?",
        ],
    }


@app.post("/sounds/upload")
async def sounds_upload(
    file: UploadFile = File(...),
    name: str = Form(""),
    duration_ms: int = Form(0),
    sample_rate: int = Form(16000),
    source: str = Form("esp32"),
) -> Dict[str, Any]:
    data = await file.read()
    if len(data) < 64:
        raise HTTPException(status_code=400, detail="WAV too small")
    try:
        row = await sounds_store.upload_sound(
            data,
            name=name or None,
            duration_ms=duration_ms,
            sample_rate=sample_rate,
            source=source or "esp32",
        )
    except Exception as err:
        raise HTTPException(status_code=502, detail=str(err)) from err
    return {"status": "ok", "sound": row}


def _pcm16le_to_wav(pcm: bytes, sample_rate: int) -> bytes:
    """Wrap raw mono PCM16 little-endian as a WAV blob."""
    import struct

    sr = max(8000, int(sample_rate or 16000))
    data_size = len(pcm)
    byte_rate = sr * 2
    block_align = 2
    bits = 16
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
        byte_rate,
        block_align,
        bits,
        b"data",
        data_size,
    )
    return header + pcm


# Last ESP32 Wi‑Fi control-plane announce (for webpage discovery without USB).
_esp32_announce: Dict[str, Any] = {}


@app.post("/esp32/announce")
async def esp32_announce(request: Request) -> Dict[str, Any]:
    """ESP32 POSTs {ip, port} after joining hotspot so the web UI can find it."""
    global _esp32_announce
    try:
        body = await request.json()
    except Exception:
        body = {}
    if not isinstance(body, dict):
        body = {}
    ip = str(body.get("ip") or "").strip()
    port = int(body.get("port") or 8080)
    if not ip:
        raise HTTPException(status_code=400, detail="missing ip")
    _esp32_announce = {
        "ip": ip,
        "port": port,
        "base": f"http://{ip}:{port}",
        "recording": bool(body.get("recording")),
        "updatedAt": time.time(),
    }
    return {"status": "ok", "esp32": _esp32_announce}


@app.get("/esp32")
def esp32_info() -> Dict[str, Any]:
    if not _esp32_announce:
        return {"status": "missing", "esp32": None}
    return {"status": "ok", "esp32": _esp32_announce}


@app.get("/esp32/metrics")
async def esp32_metrics_proxy() -> Response:
    """Proxy live metrics so the browser only talks to Python if ESP32 CORS/LAN is awkward."""
    import urllib.error
    import urllib.request

    base = (_esp32_announce or {}).get("base")
    if not base:
        raise HTTPException(status_code=404, detail="ESP32 not announced yet")
    url = f"{str(base).rstrip('/')}/metrics"

    def _fetch() -> bytes:
        with urllib.request.urlopen(url, timeout=1.2) as resp:
            return resp.read()

    try:
        data = await asyncio.to_thread(_fetch)
        return Response(
            content=data,
            media_type="application/json",
            headers={"Cache-Control": "no-store", "Access-Control-Allow-Origin": "*"},
        )
    except urllib.error.HTTPError as err:
        raise HTTPException(status_code=502, detail=f"ESP32 HTTP {err.code}") from err
    except Exception as err:
        raise HTTPException(status_code=502, detail=str(err)) from err


@app.post("/esp32/record/{action}")
async def esp32_record_proxy(action: str) -> Dict[str, Any]:
    """Proxy record start/stop through Python → ESP32 HTTP control plane."""
    import urllib.error
    import urllib.request

    act = (action or "").strip().lower()
    if act not in ("start", "stop"):
        raise HTTPException(status_code=400, detail="action must be start|stop")
    base = (_esp32_announce or {}).get("base")
    if not base:
        raise HTTPException(status_code=404, detail="ESP32 not announced yet")
    url = f"{str(base).rstrip('/')}/record/{act}"
    req = urllib.request.Request(url, data=b"", method="POST")

    def _fetch() -> str:
        with urllib.request.urlopen(req, timeout=3.0) as resp:
            return resp.read().decode("utf-8", errors="replace")

    try:
        raw = await asyncio.to_thread(_fetch)
    except urllib.error.HTTPError as err:
        raise HTTPException(status_code=502, detail=f"ESP32 HTTP {err.code}") from err
    except Exception as err:
        raise HTTPException(status_code=502, detail=str(err)) from err
    try:
        payload = json.loads(raw) if raw else {"ok": True}
    except json.JSONDecodeError:
        payload = {"ok": True, "raw": raw}
    return {"status": "ok", "esp32": _esp32_announce, "result": payload}


@app.post("/sounds/upload_pcm")
async def sounds_upload_pcm(
    request: Request,
    sample_rate: int = 16000,
    name: str = "",
    source: str = "esp32-wifi",
) -> Dict[str, Any]:
    """ESP32 Wi‑Fi path: raw mono PCM16 LE body → WAV → Supabase/local store."""
    pcm = await request.body()
    if len(pcm) < 256:
        raise HTTPException(status_code=400, detail="PCM too small")
    if len(pcm) % 2 == 1:
        pcm = pcm[:-1]
    sr = int(sample_rate or 16000)
    duration_ms = int(round(1000.0 * (len(pcm) / 2) / max(1, sr)))
    wav = _pcm16le_to_wav(pcm, sr)
    try:
        row = await sounds_store.upload_sound(
            wav,
            name=name or None,
            duration_ms=duration_ms,
            sample_rate=sr,
            source=source or "esp32-wifi",
        )
    except Exception as err:
        raise HTTPException(status_code=502, detail=str(err)) from err
    return {"status": "ok", "sound": row, "duration_ms": duration_ms, "pcm_bytes": len(pcm)}


@app.get("/sounds")
async def sounds_list(since: str = "") -> Dict[str, Any]:
    """List sounds. Optional since=ISO8601 filters created_at >= since (cross-device sync)."""
    try:
        rows = await sounds_store.list_sounds()
    except Exception as err:
        raise HTTPException(status_code=502, detail=str(err)) from err
    since_s = (since or "").strip()
    if since_s:
        filtered = []
        for row in rows or []:
            created = str((row or {}).get("created_at") or "")
            if created and created >= since_s:
                filtered.append(row)
        rows = filtered
    return {"status": "ok", "sounds": rows, "backend": sounds_store.status(), "since": since_s or None}


@app.get("/sounds/{sound_id}")
async def sounds_get(sound_id: str) -> Dict[str, Any]:
    row = await sounds_store.get_sound(sound_id)
    if not row:
        raise HTTPException(status_code=404, detail="Sound not found")
    return {"status": "ok", "sound": row}


@app.get("/sounds/{sound_id}/audio")
async def sounds_audio(sound_id: str) -> Response:
    blob = await sounds_store.read_audio_bytes(sound_id)
    if not blob:
        raise HTTPException(status_code=404, detail="Audio not found")
    return Response(content=blob, media_type="audio/wav")


@app.patch("/sounds/{sound_id}")
async def sounds_patch(sound_id: str, body: Dict[str, Any]) -> Dict[str, Any]:
    try:
        row = await sounds_store.patch_sound(sound_id, body or {})
    except Exception as err:
        raise HTTPException(status_code=502, detail=str(err)) from err
    if not row:
        raise HTTPException(status_code=404, detail="Sound not found")
    return {"status": "ok", "sound": row}


@app.delete("/sounds/{sound_id}")
async def sounds_delete(sound_id: str) -> Dict[str, Any]:
    try:
        deleted = await sounds_store.delete_sound(sound_id)
    except Exception as err:
        raise HTTPException(status_code=502, detail=str(err)) from err
    if not deleted:
        raise HTTPException(status_code=404, detail="Sound not found")
    return {"status": "ok", "id": sound_id}


@app.post("/analyze/wav")
async def analyze_wav(file: UploadFile = File(...)) -> FullAnalysisResponse:
    """Mode B — Qwen category → strokePattern; local acoustics → within-class brushParams."""
    data = await file.read()
    wav_path = config.OUTPUT_DIR / (file.filename or f"analyze_{int(time.time())}.wav")
    wav_path.write_bytes(data)

    semantic = None
    semantic_error = None
    category = None
    try:
        from siliconflow_omni import analyze_semantic

        raw_semantic, raw_error = analyze_semantic(data)
        if raw_semantic:
            semantic = SemanticAnalysis(**raw_semantic)
            category = (semantic.archetype or "").strip() or None
            semantic_error = None
        else:
            semantic = None
            semantic_error = SemanticError(**(raw_error or {
                "code": "unknown",
                "message": "声音识别失败，请重试",
            }))
    except Exception:
        semantic = None
        semantic_error = SemanticError(
            code="exception",
            message="声音识别失败，请重试",
        )

    # Re-run mapping with Qwen category so strokePattern + category ranges apply.
    features, modifiers, brush, acoustic, export = analyze_wav_bytes(
        data, category=category
    )

    return FullAnalysisResponse(
        features=AudioFeatures(**features),
        visualModifiers=VisualModifiers(**modifiers),
        brushParams=BrushParams(**brush),
        acoustic=acoustic,  # type: ignore[arg-type]
        analysisExport=export,
        duration=float(acoustic.get("duration", 0)),
        semantic=semantic,
        semanticError=semantic_error,
    )


@app.websocket(config.WS_AUDIO_PATH)
async def ws_audio(websocket: WebSocket) -> None:
    await websocket.accept()
    last_seq = -1
    min_interval = 1.0 / max(1, config.ANALYSIS_TARGET_HZ)
    last_at = 0.0

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                payload = json.loads(raw)
            except json.JSONDecodeError:
                continue

            if payload.get("type") != "audio_frame":
                continue

            seq = int(payload.get("sequence", 0))
            if seq < last_seq:
                continue
            last_seq = seq

            now = time.time()
            if now - last_at < min_interval:
                continue
            last_at = now

            msg = AudioFrameMessage.model_validate(payload)
            features_dict = analyze_pcm_frame(list(msg.samples), msg.sampleRate)
            features_dict = smoother.smooth_features(features_dict)
            modifiers = features_to_modifiers(features_dict)
            brush = modifiers_to_brush(modifiers, features_dict)

            result = AnalysisResultMessage(
                timestamp=int(time.time() * 1000),
                sequence=seq,
                features=AudioFeatures(**features_dict),
                visualModifiers=VisualModifiers(**modifiers),
                brushParams=BrushParams(**brush),
            )
            await websocket.send_text(result.model_dump_json())
    except WebSocketDisconnect:
        return


def _librosa_flag() -> bool:
    try:
        import librosa  # noqa: F401

        return True
    except ImportError:
        return False


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app:app", host=config.HOST, port=config.PORT, reload=False)
