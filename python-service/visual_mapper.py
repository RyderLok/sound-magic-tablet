"""Map normalized audio features → p5.js visual modifiers.

Axes are intentionally decorrelated so loudness does not drive density,
motion, and radius together:
  density   ← spectral richness / band fill (not loudness)
  motion    ← tempo + centroid (time/brightness motion)
  scale     ← bass + dynamic range (body / radius)
  turbulence← roughness / noisiness
  continuity← stability (low zcr / low spectralVariation)
"""
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

    # Decorrelated drivers (each axis owned by different feature groups).
    # Loudness (v/e) only gets a small residual so silence still reads quiet.
    band_fill = clamp01(b * 0.25 + m * 0.4 + t * 0.35)
    richness = clamp01(sv * 0.55 + br * 0.25 + (1.0 - abs(m - t)) * 0.2)

    raw = {
        # How fast / lively the stroke evolves — tempo & brightness, not RMS.
        "motionIntensity": clamp01(tempo * 0.5 + sc * 0.3 + sv * 0.15 + v * 0.05),
        # Chaos — roughness / noisiness.
        "turbulence": clamp01(r * 0.55 + z * 0.35 + sv * 0.1),
        # Mark complexity — spectral variation + treble detail.
        "strokeComplexity": clamp01(sv * 0.5 + t * 0.3 + r * 0.2),
        # Particle count — spectral fill / richness; loudness barely touches it.
        "particleDensity": clamp01(richness * 0.45 + band_fill * 0.4 + e * 0.1 + v * 0.05),
        # Softness — inverse noisiness.
        "smoothness": clamp01(1.0 - r * 0.55 - z * 0.3 - sv * 0.15),
        "organicFactor": clamp01(sv * 0.45 + m * 0.35 + (1 - dr) * 0.2),
        # Flow — tempo + continuity proxy; little loudness.
        "flowSpeed": clamp01(tempo * 0.55 + sc * 0.3 + (1 - z) * 0.1 + v * 0.05),
        # Spatial spread — dynamic range + bass body.
        "spread": clamp01(dr * 0.55 + b * 0.35 + sv * 0.1),
        # Stroke coherence — stability, not energy.
        "continuity": clamp01((1 - z) * 0.45 + (1 - sv) * 0.35 + m * 0.2),
        # Pulse / grid tempo — rhythm first.
        "pulseStrength": clamp01(tempo * 0.65 + p * 0.2 + e * 0.1 + v * 0.05),
        "rotationSpeed": clamp01(tempo * 0.7 + sc * 0.2 + t * 0.1),
        # Radius / body scale — bass + dynamic envelope, not copy of motion.
        "scaleResponse": clamp01(b * 0.5 + dr * 0.35 + e * 0.1 + v * 0.05),
    }
    return normalize_modifiers(raw)


def modifiers_to_brush(modifiers: Mapping[str, Any], features: Mapping[str, Any]) -> Dict[str, Any]:
    m = normalize_modifiers(modifiers)
    f = normalize_features(features)
    # Keep density and particleDensity aligned but not re-mixed with volume.
    density = clamp01(m["particleDensity"])
    return {
        # Radius axis — scaleResponse only (no extra volume boost).
        "strokeWidth": clamp01(m["scaleResponse"]),
        "flow": clamp01(m["flowSpeed"] * 0.7 + m["continuity"] * 0.3),
        "density": density,
        "turbulence": clamp01(m["turbulence"]),
        # Motion axis — motionIntensity only (tempo/centroid driven).
        "motion": clamp01(m["motionIntensity"]),
        "continuity": clamp01(m["continuity"]),
        "particleDensity": density,
        "rotationSpeed": clamp01(m["rotationSpeed"]),
        "smoothness": clamp01(m["smoothness"]),
        "scaleResponse": clamp01(m["scaleResponse"]),
        "styleModifiers": {
            "organicFactor": m["organicFactor"],
            "pulseStrength": m["pulseStrength"],
            "spread": m["spread"],
            "strokeComplexity": m["strokeComplexity"],
            "brightness": f["brightness"],
            "pitch": f["pitch"],
            # Explicit axis tags for debug / future UI.
            "axisDensity": density,
            "axisMotion": clamp01(m["motionIntensity"]),
            "axisScale": clamp01(m["scaleResponse"]),
            "axisTurbulence": clamp01(m["turbulence"]),
        },
    }
