"""Extract normalized (0–1) acoustic features for within-category brush variation.

Local analysis does NOT classify sound category — only measures acoustics.
"""
from __future__ import annotations

import math
from typing import Any, Dict, List, Mapping, Optional

import numpy as np

from feature_normalizer import clamp01

ACOUSTIC_FEATURE_KEYS = (
    "rms",
    "peak",
    "spectralCentroid",
    "bassRatio",
    "midRatio",
    "trebleRatio",
    "spectralFlatness",
    "roughness",
    "spectralFlux",
    "tempo",
    "onsetDensity",
    "pulseRegularity",
    "silenceRatio",
    "continuity",
    "eventDuration",
)


def empty_acoustic_features() -> Dict[str, float]:
    return {k: 0.0 for k in ACOUSTIC_FEATURE_KEYS}


def extract_acoustic_features(
    y: np.ndarray,
    sr: int,
    *,
    prior: Optional[Mapping[str, float]] = None,
    smooth: float = 0.0,
) -> Dict[str, float]:
    """Return full-clip acoustic features in 0–1.

    ``smooth`` blends with ``prior`` (EMA): out = prior*smooth + current*(1-smooth).
    Mode B typically uses smooth=0 (fresh clip). Live path may pass prior.
    """
    y = np.asarray(y, dtype=np.float32).reshape(-1)
    out = empty_acoustic_features()
    if len(y) < 64 or sr <= 0:
        return _maybe_smooth(out, prior, smooth)

    rms_raw = float(np.sqrt(np.mean(y ** 2)))
    peak_raw = float(np.max(np.abs(y)))
    out["rms"] = clamp01(rms_raw / 0.28)
    out["peak"] = clamp01(peak_raw / 0.95)

    try:
        import librosa

        if len(y) < 256:
            return _maybe_smooth(_fallback_no_librosa(y, sr, out), prior, smooth)

        hop = 512
        n_fft = 2048
        S = np.abs(librosa.stft(y, n_fft=n_fft, hop_length=hop))
        freqs = librosa.fft_frequencies(sr=sr, n_fft=n_fft)
        power = S ** 2
        total_band = float(np.sum(power) + 1e-9)

        cent = float(np.mean(librosa.feature.spectral_centroid(S=S, sr=sr)))
        out["spectralCentroid"] = clamp01(cent / max(1.0, sr * 0.45))

        bass = float(np.sum(power[freqs < 250]) / total_band)
        mid = float(np.sum(power[(freqs >= 250) & (freqs < 2000)]) / total_band)
        treble = float(np.sum(power[freqs >= 2000]) / total_band)
        out["bassRatio"] = clamp01(bass)
        out["midRatio"] = clamp01(mid)
        out["trebleRatio"] = clamp01(treble)

        flat = float(np.mean(librosa.feature.spectral_flatness(S=S)))
        out["spectralFlatness"] = clamp01(flat * 4.0)

        zcr = float(np.mean(librosa.feature.zero_crossing_rate(y)))
        bandwidth = float(np.mean(librosa.feature.spectral_bandwidth(S=S, sr=sr))) / max(1.0, sr * 0.5)
        out["roughness"] = clamp01(zcr / 0.18 * 0.45 + bandwidth * 0.35 + out["spectralFlatness"] * 0.2)

        # Spectral flux (frame-to-frame positive change of normalized magnitude)
        norm = S / (np.sum(S, axis=0, keepdims=True) + 1e-9)
        flux = np.sum(np.maximum(np.diff(norm, axis=1, prepend=norm[:, :1]), 0.0), axis=0)
        out["spectralFlux"] = clamp01(float(np.mean(flux)) / 0.35)

        try:
            tempo_bpm, _ = librosa.beat.beat_track(y=y, sr=sr)
            out["tempo"] = clamp01(float(np.atleast_1d(tempo_bpm)[0]) / 180.0)
        except Exception:
            out["tempo"] = clamp01(out["spectralFlux"] * 0.5)

        onset_env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop)
        onsets = librosa.onset.onset_detect(onset_envelope=onset_env, sr=sr, units="time", hop_length=hop)
        duration = max(1e-3, len(y) / float(sr))
        out["onsetDensity"] = clamp01(len(onsets) / (duration * 8.0))

        if len(onsets) >= 3:
            intervals = np.diff(onsets)
            mean_i = float(np.mean(intervals) + 1e-9)
            cv = float(np.std(intervals) / mean_i)
            out["pulseRegularity"] = clamp01(1.0 - cv / 1.2)
        elif len(onsets) == 2:
            out["pulseRegularity"] = 0.45
        else:
            out["pulseRegularity"] = 0.2

        # Silence / continuity from RMS frames
        rms_frames = librosa.feature.rms(y=y, frame_length=n_fft, hop_length=hop)[0]
        thr = max(1e-4, float(np.percentile(rms_frames, 25)) * 0.55)
        silent = rms_frames < thr
        out["silenceRatio"] = clamp01(float(np.mean(silent.astype(np.float32))))
        out["continuity"] = clamp01(1.0 - out["silenceRatio"] * 0.85 - (1.0 - out["pulseRegularity"]) * 0.1)

        # Mean duration of contiguous non-silent runs (normalized by clip length)
        event_dur = _mean_event_duration_sec(silent, hop, sr)
        out["eventDuration"] = clamp01(event_dur / max(0.15, duration * 0.65))

        return _maybe_smooth(out, prior, smooth)
    except ImportError:
        return _maybe_smooth(_fallback_no_librosa(y, sr, out), prior, smooth)


def _mean_event_duration_sec(silent: np.ndarray, hop: int, sr: int) -> float:
    if silent.size == 0:
        return 0.0
    active = ~silent
    lengths: List[int] = []
    run = 0
    for a in active:
        if a:
            run += 1
        elif run:
            lengths.append(run)
            run = 0
    if run:
        lengths.append(run)
    if not lengths:
        return 0.0
    frame_sec = hop / float(sr)
    return float(np.mean(lengths)) * frame_sec


def _fallback_no_librosa(y: np.ndarray, sr: int, base: Dict[str, float]) -> Dict[str, float]:
    out = dict(base)
    n = min(len(y), 2048)
    window = y[:n] * np.hanning(n)
    spec = np.abs(np.fft.rfft(window))
    freqs = np.fft.rfftfreq(n, 1.0 / sr)
    power = spec ** 2
    total = float(np.sum(power) + 1e-9)
    out["bassRatio"] = clamp01(float(np.sum(power[freqs < 250]) / total))
    out["midRatio"] = clamp01(float(np.sum(power[(freqs >= 250) & (freqs < 2000)]) / total))
    out["trebleRatio"] = clamp01(float(np.sum(power[freqs >= 2000]) / total))
    centroid = float(np.sum(freqs * power) / total)
    out["spectralCentroid"] = clamp01(centroid / max(1.0, sr * 0.45))
    # Zero-crossing roughness proxy
    zc = float(np.mean(np.abs(np.diff(np.sign(y)))))
    out["roughness"] = clamp01(zc)
    out["spectralFlatness"] = clamp01(out["trebleRatio"] * 0.5)
    out["spectralFlux"] = clamp01(out["peak"] * 0.4)
    out["tempo"] = 0.35
    out["onsetDensity"] = clamp01(out["peak"] * 0.5)
    out["pulseRegularity"] = 0.4
    thr = float(np.percentile(np.abs(y), 20))
    out["silenceRatio"] = clamp01(float(np.mean(np.abs(y) < thr)))
    out["continuity"] = clamp01(1.0 - out["silenceRatio"])
    out["eventDuration"] = clamp01(0.4)
    return out


def _maybe_smooth(
    current: Dict[str, float],
    prior: Optional[Mapping[str, float]],
    smooth: float,
) -> Dict[str, float]:
    s = clamp01(smooth)
    if not prior or s <= 0:
        return {k: round(clamp01(current.get(k, 0.0)), 4) for k in ACOUSTIC_FEATURE_KEYS}
    out = {}
    for k in ACOUSTIC_FEATURE_KEYS:
        c = clamp01(current.get(k, 0.0))
        p = clamp01(prior.get(k, c))
        # Fast axes: less smoothing weight from prior when smooth is global
        if k in ("rms", "peak", "onsetDensity", "spectralFlux"):
            a = s * 0.45
        elif k in ("tempo", "continuity", "roughness", "pulseRegularity"):
            a = min(0.92, s * 1.15 + 0.15)
        else:
            a = s
        out[k] = round(p * a + c * (1.0 - a), 4)
    return out


def acoustic_to_legacy_features(acoustic: Mapping[str, float]) -> Dict[str, Any]:
    """Bridge new acousticFeatures → legacy AudioFeatures for existing UI."""
    a = {**empty_acoustic_features(), **dict(acoustic or {})}
    return {
        "volume": clamp01(a["rms"]),
        "energy": clamp01(a["rms"] * 0.55 + a["peak"] * 0.25 + a["onsetDensity"] * 0.2),
        "brightness": clamp01(a["spectralCentroid"] * 0.65 + a["trebleRatio"] * 0.35),
        "roughness": clamp01(a["roughness"]),
        "pitch": clamp01(a["spectralCentroid"]),
        "tempo": clamp01(a["tempo"]),
        "spectralCentroid": clamp01(a["spectralCentroid"]),
        "zcr": clamp01(a["roughness"] * 0.7 + a["spectralFlatness"] * 0.3),
        "dynamicRange": clamp01(abs(a["peak"] - a["rms"]) * 1.4),
        "spectralVariation": clamp01(a["spectralFlux"] * 0.55 + a["spectralFlatness"] * 0.45),
        "bass": clamp01(a["bassRatio"]),
        "mid": clamp01(a["midRatio"]),
        "treble": clamp01(a["trebleRatio"]),
        "spectrumProfile": [],
    }
