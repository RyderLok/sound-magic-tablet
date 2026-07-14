"""Map normalized audio features → p5.js visual modifiers."""
from __future__ import annotations

from typing import Any, Dict, Mapping

from feature_normalizer import MODIFIER_KEYS, clamp01, normalize_features, normalize_modifiers


def features_to_modifiers(features: Mapping[str, Any]) -> Dict[str, float]:
    f = normalize_features(features)
    v = f["volume"]
    e = f["energy"]
    b = f["bass"]
    m = f["mid"]
    t = f["treble"]
    br = f["brightness"]
    r = f["roughness"]
    z = f["zcr"]
    p = f["pitch"]
    tempo = f["tempo"]
    dr = f["dynamicRange"]
    sv = f["spectralVariation"]
    sc = f["spectralCentroid"]

    raw = {
        "motionIntensity": clamp01(v * 0.55 + e * 0.45),
        "turbulence": clamp01(r * 0.5 + z * 0.35 + sv * 0.15),
        "strokeComplexity": clamp01(sv * 0.45 + r * 0.35 + t * 0.2),
        "particleDensity": clamp01(e * 0.4 + b * 0.35 + v * 0.25),
        "smoothness": clamp01(1.0 - r * 0.55 - z * 0.25),
        "organicFactor": clamp01(sv * 0.5 + m * 0.3 + (1 - dr) * 0.2),
        "flowSpeed": clamp01(tempo * 0.45 + sc * 0.35 + v * 0.2),
        "spread": clamp01(dr * 0.55 + b * 0.3 + v * 0.15),
        "continuity": clamp01((1 - z) * 0.5 + (1 - sv) * 0.3 + m * 0.2),
        "pulseStrength": clamp01(tempo * 0.5 + v * 0.35 + e * 0.15),
        "rotationSpeed": clamp01(tempo * 0.6 + sc * 0.25 + t * 0.15),
        "scaleResponse": clamp01(v * 0.5 + b * 0.35 + e * 0.15),
    }
    return normalize_modifiers(raw)


def modifiers_to_brush(modifiers: Mapping[str, Any], features: Mapping[str, Any]) -> Dict[str, Any]:
    m = normalize_modifiers(modifiers)
    f = normalize_features(features)
    return {
        "strokeWidth": clamp01(m["scaleResponse"] * 0.7 + f["volume"] * 0.3),
        "flow": clamp01(m["flowSpeed"] * 0.65 + m["continuity"] * 0.35),
        "density": clamp01(m["particleDensity"]),
        "turbulence": clamp01(m["turbulence"]),
        "motion": clamp01(m["motionIntensity"]),
        "continuity": clamp01(m["continuity"]),
        "particleDensity": clamp01(m["particleDensity"]),
        "rotationSpeed": clamp01(m["rotationSpeed"]),
        "smoothness": clamp01(m["smoothness"]),
        "styleModifiers": {
            "organicFactor": m["organicFactor"],
            "pulseStrength": m["pulseStrength"],
            "spread": m["spread"],
            "strokeComplexity": m["strokeComplexity"],
            "brightness": f["brightness"],
            "pitch": f["pitch"],
        },
    }
