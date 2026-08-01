"""Mode B — structured analysis export for p5.js / brush pipeline.

Category / strokePattern come from Qwen (applied in app.py via brush_mapper).
Local analysis only contributes acoustic measurements — not sound class.
"""
from __future__ import annotations

from typing import Any, Dict, List, Mapping, Optional

import numpy as np

from feature_normalizer import clamp01


def build_mode_b_export(
    y: np.ndarray,
    sr: int,
    features: Mapping[str, Any],
    acoustic: Mapping[str, Any],
    *,
    acoustic_features: Optional[Mapping[str, float]] = None,
    category: Optional[str] = None,
    stroke_pattern: Optional[str] = None,
    visual_structure: Optional[Mapping[str, Any]] = None,
    brush_params: Optional[Mapping[str, Any]] = None,
) -> Dict[str, Any]:
    """Professional analysis package: spectral stats + brush-ready features."""
    duration = float(acoustic.get("duration") or len(y) / max(1, sr))
    export: Dict[str, Any] = {
        "mode": "B",
        "pipeline": [
            "ESP32/WAV capture",
            "Python librosa — acoustic features (no local class)",
            "Qwen category → strokePattern",
            "Acoustic within-class → brushParams",
            "p5.js BrushGenerator (five patterns)",
        ],
        "duration": round(duration, 4),
        "sampleRate": int(sr),
        "bandEnergy": {
            "bass": float(features.get("bass", 0)),
            "mid": float(features.get("mid", 0)),
            "treble": float(features.get("treble", 0)),
        },
        "features": dict(features),
        "brushInput": {
            "volume": float(features.get("volume", 0)),
            "energy": float(features.get("energy", 0)),
            "brightness": float(features.get("brightness", 0)),
            "roughness": float(features.get("roughness", 0)),
            "pitch": float(features.get("pitch", 0)),
            "tempo": float(features.get("tempo", 0)),
            "spectralCentroid": float(features.get("spectralCentroid", 0)),
            "dynamicRange": float(features.get("dynamicRange", 0)),
            "spectralVariation": float(features.get("spectralVariation", 0)),
        },
        "waveformPoints": len(acoustic.get("waveform") or []),
        "spectrumBins": len(acoustic.get("spectrum") or []),
        "spectrogramSize": [
            len(acoustic.get("spectrogram") or []),
            len((acoustic.get("spectrogram") or [[0]])[0]),
        ],
        "shapeProfile": dict(acoustic.get("shapeProfile") or {}),
    }

    if acoustic_features:
        export["acousticFeatures"] = dict(acoustic_features)
    if category:
        export["category"] = category
    if stroke_pattern:
        export["strokePattern"] = stroke_pattern
    if visual_structure:
        export["visualStructure"] = dict(visual_structure)
    if brush_params:
        export["brushParams"] = dict(brush_params)

    try:
        import librosa

        if len(y) >= 256:
            mfcc = librosa.feature.mfcc(y=y, sr=sr, n_mfcc=13)
            export["mfcc"] = [round(float(v), 4) for v in np.mean(mfcc, axis=1).tolist()]
            chroma = librosa.feature.chroma_stft(y=y, sr=sr)
            export["chroma"] = [round(float(v), 4) for v in np.mean(chroma, axis=1).tolist()]
            cent = librosa.feature.spectral_centroid(y=y, sr=sr)
            export["spectralCentroidHz"] = round(float(np.mean(cent)), 2)
            try:
                tempo, _ = librosa.beat.beat_track(y=y, sr=sr)
                export["tempoBpm"] = round(float(np.atleast_1d(tempo)[0]), 2)
            except Exception:
                export["tempoBpm"] = None
            try:
                f0 = librosa.yin(y, fmin=50, fmax=2000, sr=sr)
                pitch_hz = float(np.nanmedian(f0))
                if not np.isnan(pitch_hz):
                    export["pitchHz"] = round(pitch_hz, 2)
            except Exception:
                export["pitchHz"] = None
            S = np.abs(librosa.stft(y, n_fft=2048, hop_length=512))
            freqs = librosa.fft_frequencies(sr=sr, n_fft=2048)
            power = np.mean(S ** 2, axis=1)
            peaks = _top_spectral_peaks(freqs, power, top_n=5)
            export["spectralPeaks"] = peaks
            if peaks:
                export["dominantFreqHz"] = peaks[0]["frequencyHz"]
    except ImportError:
        export["mfcc"] = []
        export["chroma"] = []

    # brushReady when we have acoustic features; category optional until Qwen returns
    export["brushReady"] = bool(acoustic_features or features)
    export["categorySource"] = "qwen" if category else None
    return export


def _top_spectral_peaks(
    freqs: np.ndarray, power: np.ndarray, top_n: int = 5
) -> List[Dict[str, float]]:
    if len(power) < 3:
        return []
    idx = np.argsort(power)[::-1][: top_n * 3]
    seen: List[int] = []
    peaks: List[Dict[str, float]] = []
    for i in idx:
        if i <= 0 or i >= len(power) - 1:
            continue
        if power[i] < power[i - 1] or power[i] < power[i + 1]:
            continue
        if any(abs(int(i) - s) < 8 for s in seen):
            continue
        seen.append(int(i))
        peaks.append({
            "frequencyHz": round(float(freqs[i]), 2),
            "magnitude": round(clamp01(float(power[i] / (np.max(power) + 1e-9))), 4),
        })
        if len(peaks) >= top_n:
            break
    peaks.sort(key=lambda p: p["magnitude"], reverse=True)
    return peaks
