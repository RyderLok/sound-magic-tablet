"""Legacy modifiers bridge.

Mode B brush mapping lives in ``brush_mapper.map_acoustic_to_brush``.
This module remains for Mode A WebSocket frames and older callers.
"""
from __future__ import annotations

from typing import Any, Dict, Mapping

from brush_mapper import brush_to_modifiers, map_acoustic_to_brush
from feature_normalizer import clamp01, normalize_features, normalize_modifiers


def features_to_modifiers(features: Mapping[str, Any]) -> Dict[str, float]:
    """Approximate modifiers from legacy feature dict (live WS path)."""
    f = normalize_features(features)
    # Map legacy → pseudo acoustic then brush → modifiers
    acoustic = {
        "rms": f["volume"],
        "peak": clamp01(f["volume"] * 0.7 + f["energy"] * 0.3),
        "spectralCentroid": f["spectralCentroid"],
        "bassRatio": f["bass"],
        "midRatio": f["mid"],
        "trebleRatio": f["treble"],
        "spectralFlatness": f["spectralVariation"],
        "roughness": f["roughness"],
        "spectralFlux": f["spectralVariation"],
        "tempo": f["tempo"],
        "onsetDensity": clamp01(f["tempo"] * 0.5 + f["energy"] * 0.3),
        "pulseRegularity": clamp01(1.0 - f["roughness"] * 0.4),
        "silenceRatio": clamp01(1.0 - f["volume"]),
        "continuity": clamp01(1.0 - f["zcr"]),
        "eventDuration": clamp01(f["dynamicRange"]),
    }
    brush = map_acoustic_to_brush(None, acoustic)
    return normalize_modifiers(brush_to_modifiers(brush))


def modifiers_to_brush(modifiers: Mapping[str, Any], features: Mapping[str, Any]) -> Dict[str, Any]:
    """Legacy path — prefer acoustic mapping when features look like AudioFeatures."""
    f = normalize_features(features)
    acoustic = {
        "rms": f["volume"],
        "peak": clamp01(f["energy"]),
        "spectralCentroid": f["spectralCentroid"],
        "bassRatio": f["bass"],
        "midRatio": f["mid"],
        "trebleRatio": f["treble"],
        "spectralFlatness": f["spectralVariation"],
        "roughness": f["roughness"],
        "spectralFlux": f["spectralVariation"],
        "tempo": f["tempo"],
        "onsetDensity": clamp01(f["tempo"] * 0.55 + f["energy"] * 0.25),
        "pulseRegularity": clamp01(0.5),
        "silenceRatio": clamp01(1.0 - f["volume"]),
        "continuity": clamp01(1.0 - f["zcr"]),
        "eventDuration": clamp01(f["dynamicRange"]),
    }
    return map_acoustic_to_brush(None, acoustic)
