"""Normalize, clamp, and merge audio feature dicts."""
from __future__ import annotations

import math
from typing import Any, Dict, List, Mapping, MutableMapping, Optional

FEATURE_KEYS = (
    "volume",
    "energy",
    "brightness",
    "roughness",
    "pitch",
    "tempo",
    "spectralCentroid",
    "zcr",
    "dynamicRange",
    "spectralVariation",
    "bass",
    "mid",
    "treble",
)

MODIFIER_KEYS = (
    "motionIntensity",
    "turbulence",
    "strokeComplexity",
    "particleDensity",
    "smoothness",
    "organicFactor",
    "flowSpeed",
    "spread",
    "continuity",
    "pulseStrength",
    "rotationSpeed",
    "scaleResponse",
)


def clamp01(value: Any, default: float = 0.0) -> float:
    try:
        n = float(value)
    except (TypeError, ValueError):
        return default
    if not math.isfinite(n):
        return default
    return max(0.0, min(1.0, n))


def empty_features() -> Dict[str, Any]:
    return {k: 0.0 for k in FEATURE_KEYS} | {"spectrumProfile": []}


def normalize_features(raw: Optional[Mapping[str, Any]]) -> Dict[str, Any]:
    src = raw or {}
    out = empty_features()

    for key in FEATURE_KEYS:
        out[key] = clamp01(src.get(key, out[key]))

    # Legacy / adapter aliases
    if src.get("spectralCentroid") is None and src.get("brightness") is not None:
        out["spectralCentroid"] = clamp01(src.get("brightness"))
    if src.get("spectralVariation") is None and src.get("roughness") is not None:
        out["spectralVariation"] = clamp01(src.get("roughness"))

    profile = src.get("spectrumProfile")
    if profile is None:
        out["spectrumProfile"] = []
    elif hasattr(profile, "tolist"):
        out["spectrumProfile"] = [clamp01(v / 255.0 if v > 1 else v) for v in profile.tolist()[:128]]
    else:
        out["spectrumProfile"] = [clamp01(v / 255.0 if isinstance(v, (int, float)) and v > 1 else v) for v in list(profile)[:128]]

    return out


def normalize_modifiers(raw: Optional[Mapping[str, Any]]) -> Dict[str, float]:
    src = raw or {}
    return {k: clamp01(src.get(k, 0.0)) for k in MODIFIER_KEYS}


def merge_features(base: Mapping[str, Any], overlay: Mapping[str, Any], weight: float = 0.6) -> Dict[str, Any]:
    w = clamp01(weight, 0.6)
    a = normalize_features(base)
    b = normalize_features(overlay)
    merged = empty_features()

    for key in FEATURE_KEYS:
        merged[key] = clamp01(a[key] * (1 - w) + b[key] * w)

    pa = a.get("spectrumProfile") or []
    pb = b.get("spectrumProfile") or []
    length = max(len(pa), len(pb), 1)
    merged["spectrumProfile"] = [
        clamp01((pa[i] if i < len(pa) else 0) * (1 - w) + (pb[i] if i < len(pb) else 0) * w)
        for i in range(min(length, 128))
    ]
    return merged


class EmaSmoother:
    """Exponential moving average per scalar field."""

    def __init__(self, alpha: float = 0.28):
        self.alpha = alpha
        self._state: Dict[str, float] = {}

    def smooth_features(self, features: Mapping[str, Any]) -> Dict[str, Any]:
        normed = normalize_features(features)
        for key in FEATURE_KEYS:
            prev = self._state.get(key, normed[key])
            self._state[key] = prev + self.alpha * (normed[key] - prev)
            normed[key] = self._state[key]
        return normed
