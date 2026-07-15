"""FastAPI + WebSocket — real-time (Mode A) and full WAV (Mode B) analysis."""
from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any, Dict

from fastapi import FastAPI, File, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

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

app = FastAPI(title="Piko Python Enhancement", version="1.0.0")
smoother = EmaSmoother(alpha=0.28)

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS + ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> Dict[str, Any]:
    base = f"http://127.0.0.1:{config.PORT}"
    ws = f"ws://127.0.0.1:{config.PORT}{config.WS_AUDIO_PATH}"
    omni = {"configured": False}
    try:
        from siliconflow_omni import status as omni_status

        omni = omni_status()
    except Exception:
        pass
    return {
        "status": "ok",
        "http": base,
        "ws": ws,
        "endpoints": {
            "health": f"{base}/health",
            "analyzeWav": f"{base}/analyze/wav",
            "wsAudio": ws,
        },
        "librosa": _librosa_flag(),
        "sampleRate": config.SAMPLE_RATE,
        "analysisHz": config.ANALYSIS_TARGET_HZ,
        "omni": omni,
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


@app.post("/analyze/wav")
async def analyze_wav(file: UploadFile = File(...)) -> FullAnalysisResponse:
    """Mode B — sound → waveform / spectrum / spectrogram → visual structure + brush."""
    data = await file.read()
    wav_path = config.OUTPUT_DIR / (file.filename or f"analyze_{int(time.time())}.wav")
    wav_path.write_bytes(data)

    features, modifiers, brush, acoustic, export = analyze_wav_bytes(data)

    semantic = None
    semantic_error = None
    try:
        from siliconflow_omni import analyze_semantic

        raw_semantic, raw_error = analyze_semantic(data)
        if raw_semantic:
            semantic = SemanticAnalysis(**raw_semantic)
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
