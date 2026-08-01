"""Map Qwen category + local acousticFeatures → brushParams within category ranges.

Qwen chooses strokePattern; acoustics only offset parameters inside BRUSH_RANGES.
"""
from __future__ import annotations

from typing import Any, Dict, Mapping, Optional, Tuple

from feature_normalizer import clamp01
from natural_sound_archetypes import ARCHETYPES, VISUAL_STRUCTURES

CATEGORY_TO_PATTERN = {
    "birds": "scatter_points",
    "wind_leaves": "flow_field",
    "water": "wave_ripple",
    "material_impact": "impact_burst",
    "insects_amphibians": "pulse_grid",
}

# Per-category allowed ranges: acoustics only move params inside [lo, hi].
BRUSH_RANGES: Dict[str, Dict[str, Tuple[float, float]]] = {
    "birds": {
        "brushSize": (0.22, 0.58),
        "density": (0.32, 0.92),
        "movementSpeed": (0.35, 0.88),
        "turbulence": (0.22, 0.78),
        "continuity": (0.12, 0.55),
        "trailLength": (0.10, 0.48),
        "spawnRate": (0.35, 0.95),
        "particleSize": (0.15, 0.55),
        "gapProbability": (0.25, 0.85),
    },
    "wind_leaves": {
        "brushSize": (0.35, 0.82),
        "density": (0.28, 0.75),
        "movementSpeed": (0.20, 0.70),
        "turbulence": (0.25, 0.85),
        "continuity": (0.45, 0.92),
        "trailLength": (0.40, 0.90),
        "spawnRate": (0.25, 0.70),
        "particleSize": (0.25, 0.65),
        "gapProbability": (0.05, 0.40),
    },
    "water": {
        "brushSize": (0.40, 0.90),
        "density": (0.38, 0.82),
        "movementSpeed": (0.18, 0.62),
        "turbulence": (0.10, 0.52),
        "continuity": (0.40, 0.95),
        "trailLength": (0.35, 0.92),
        "spawnRate": (0.30, 0.78),
        "particleSize": (0.30, 0.70),
        "gapProbability": (0.08, 0.55),
    },
    "material_impact": {
        "brushSize": (0.28, 0.95),
        "density": (0.30, 0.80),
        "movementSpeed": (0.40, 0.95),
        "turbulence": (0.20, 0.75),
        "continuity": (0.08, 0.42),
        "trailLength": (0.08, 0.45),
        "spawnRate": (0.25, 0.90),
        "particleSize": (0.25, 0.75),
        "gapProbability": (0.35, 0.90),
    },
    "insects_amphibians": {
        "brushSize": (0.20, 0.70),
        "density": (0.40, 0.95),
        "movementSpeed": (0.25, 0.75),
        "turbulence": (0.15, 0.65),
        "continuity": (0.20, 0.70),
        "trailLength": (0.15, 0.60),
        "spawnRate": (0.40, 0.98),
        "particleSize": (0.12, 0.60),
        "gapProbability": (0.15, 0.70),
    },
}


def _in_range(category: str, key: str, t: float) -> float:
    ranges = BRUSH_RANGES.get(category) or BRUSH_RANGES["wind_leaves"]
    lo, hi = ranges.get(key, (0.15, 0.85))
    return round(lo + (hi - lo) * clamp01(t), 4)


def map_acoustic_to_brush(
    category: Optional[str],
    acoustic: Mapping[str, float],
) -> Dict[str, Any]:
    """Build brushParams. Category gates ranges; missing category uses wind_leaves ranges only for numeric params (no strokePattern claim)."""
    a = dict(acoustic or {})
    cat = category if category in CATEGORY_TO_PATTERN else None
    range_cat = cat or "wind_leaves"

    rms = clamp01(a.get("rms"))
    peak = clamp01(a.get("peak"))
    sc = clamp01(a.get("spectralCentroid"))
    bass = clamp01(a.get("bassRatio"))
    mid = clamp01(a.get("midRatio"))
    treble = clamp01(a.get("trebleRatio"))
    flat = clamp01(a.get("spectralFlatness"))
    rough = clamp01(a.get("roughness"))
    flux = clamp01(a.get("spectralFlux"))
    tempo = clamp01(a.get("tempo"))
    onset = clamp01(a.get("onsetDensity"))
    regular = clamp01(a.get("pulseRegularity"))
    continuity = clamp01(a.get("continuity"))
    silence = clamp01(a.get("silenceRatio"))
    event_dur = clamp01(a.get("eventDuration"))

    # 1) Volume → scale / weight (not density/motion)
    size_t = clamp01(rms * 0.72 + peak * 0.18 + bass * 0.10)
    expansion_t = clamp01(peak * 0.75 + rms * 0.15 + onset * 0.10)
    stroke_w_t = clamp01(rms * 0.55 + bass * 0.35 + (1.0 - treble) * 0.10)

    # 2) Frequency → detail / spatial tendency
    particle_size_t = clamp01((1.0 - sc) * 0.55 + bass * 0.35 + (1.0 - treble) * 0.10)
    detail_t = clamp01(treble * 0.5 + sc * 0.4 + mid * 0.1)
    local_motion_t = clamp01(sc * 0.45 + treble * 0.4 + flux * 0.15)
    vertical_bias_t = clamp01(treble * 0.55 + sc * 0.3 + (1.0 - bass) * 0.15)
    edge_sharp_t = clamp01(treble * 0.6 + sc * 0.25 + (1.0 - flat) * 0.15)

    # 3) Roughness → irregularity
    turb_t = clamp01(rough * 0.55 + flat * 0.25 + flux * 0.20)
    jitter_t = clamp01(rough * 0.5 + flux * 0.35 + onset * 0.15)
    edge_noise_t = clamp01(flat * 0.55 + rough * 0.35 + treble * 0.10)
    deform_t = clamp01(flux * 0.65 + rough * 0.25 + onset * 0.10)
    smooth_t = clamp01(1.0 - rough * 0.55 - flat * 0.30 - flux * 0.15)

    # 4) Rhythm → spawn / pulse (not the same as movementSpeed)
    pulse_t = clamp01(tempo * 0.7 + regular * 0.2 + onset * 0.1)
    spawn_t = clamp01(onset * 0.65 + tempo * 0.25 + (1.0 - silence) * 0.10)
    spacing_t = clamp01((1.0 - onset) * 0.45 + regular * 0.4 + (1.0 - tempo) * 0.15)
    repeat_t = clamp01((1.0 - tempo) * 0.55 + regular * 0.35 + silence * 0.10)
    rhythm_t = clamp01(regular * 0.55 + tempo * 0.35 + onset * 0.10)

    # 5) Continuity → trails / gaps
    trail_t = clamp01(continuity * 0.65 + event_dur * 0.25 + (1.0 - silence) * 0.10)
    connect_t = clamp01(continuity * 0.7 + (1.0 - silence) * 0.2 + event_dur * 0.1)
    persist_t = clamp01(event_dur * 0.55 + continuity * 0.35 + (1.0 - onset) * 0.10)
    gap_t = clamp01(silence * 0.65 + (1.0 - continuity) * 0.25 + (1.0 - regular) * 0.10)
    fade_t = clamp01((1.0 - persist_t) * 0.5 + silence * 0.3 + gap_t * 0.2)

    # Movement speed: bass slows, centroid/treble quickens — NOT rms-led
    move_t = clamp01(sc * 0.35 + treble * 0.25 + tempo * 0.2 + (1.0 - bass) * 0.15 + rms * 0.05)

    # 6) Vibration (multi-feature; not volume-only)
    vib_amp = clamp01(rough * 0.45 + flux * 0.30 + rms * 0.15 + onset * 0.10)
    vib_freq = clamp01(tempo * 0.4 + sc * 0.3 + flux * 0.2 + onset * 0.1)
    vib_rand = clamp01(rough * 0.5 + flat * 0.3 + (1.0 - regular) * 0.2)

    density_t = clamp01(spawn_t * 0.55 + detail_t * 0.35 + (1.0 - particle_size_t) * 0.10)

    brush = {
        # New explicit axes
        "brushSize": _in_range(range_cat, "brushSize", size_t),
        "radius": _in_range(range_cat, "brushSize", clamp01(size_t * 0.85 + expansion_t * 0.15)),
        "strokeWidth": _in_range(range_cat, "brushSize", stroke_w_t),
        "expansion": round(clamp01(expansion_t), 4),
        "particleSize": _in_range(range_cat, "particleSize", particle_size_t),
        "detailScale": round(clamp01(detail_t), 4),
        "verticalBias": round(clamp01(vertical_bias_t), 4),
        "edgeSharpness": round(clamp01(edge_sharp_t), 4),
        "localMotion": round(clamp01(local_motion_t), 4),
        "turbulence": _in_range(range_cat, "turbulence", turb_t),
        "jitter": round(clamp01(jitter_t), 4),
        "edgeNoise": round(clamp01(edge_noise_t), 4),
        "deformation": round(clamp01(deform_t), 4),
        "deformationSpeed": round(clamp01(flux), 4),
        "smoothness": round(clamp01(smooth_t), 4),
        "spawnRate": _in_range(range_cat, "spawnRate", spawn_t),
        "pulseRate": round(clamp01(pulse_t), 4),
        "spacing": round(clamp01(spacing_t), 4),
        "repeatInterval": round(clamp01(repeat_t), 4),
        "rhythmStrength": round(clamp01(rhythm_t), 4),
        "trailLength": _in_range(range_cat, "trailLength", trail_t),
        "connectionStrength": round(clamp01(connect_t), 4),
        "strokePersistence": round(clamp01(persist_t), 4),
        "gapProbability": _in_range(range_cat, "gapProbability", gap_t),
        "fadeDuration": round(clamp01(fade_t), 4),
        "movementSpeed": _in_range(range_cat, "movementSpeed", move_t),
        "vibrationAmplitude": round(vib_amp, 4),
        "vibrationFrequency": round(vib_freq, 4),
        "vibrationRandomness": round(vib_rand, 4),
        "continuity": _in_range(range_cat, "continuity", continuity),
        "density": _in_range(range_cat, "density", density_t),
        # Legacy aliases consumed by BrushGenerator / BrushSchema
        "particleDensity": _in_range(range_cat, "density", density_t),
        "motion": _in_range(range_cat, "movementSpeed", move_t),
        "flow": _in_range(range_cat, "trailLength", trail_t),
        "rotationSpeed": round(clamp01(pulse_t), 4),
        "scaleResponse": _in_range(range_cat, "brushSize", size_t),
        "styleModifiers": {
            "axisVolume": round(size_t, 4),
            "axisFrequency": round(detail_t, 4),
            "axisRoughness": round(turb_t, 4),
            "axisRhythm": round(spawn_t, 4),
            "axisContinuity": round(trail_t, 4),
            "category": cat,
            "rangeCategory": range_cat,
        },
    }
    return brush


def visual_structure_for_category(category: Optional[str]) -> Optional[Dict[str, Any]]:
    if not category or category not in VISUAL_STRUCTURES:
        return None
    base = dict(VISUAL_STRUCTURES[category])
    meta = ARCHETYPES.get(category, {})
    return {
        "archetypeId": category,
        "strokePattern": CATEGORY_TO_PATTERN[category],
        "motionModel": base.get("motionModel"),
        "texturePattern": base.get("texturePattern"),
        "strokeBehavior": base.get("strokeBehavior"),
        "paletteBias": base.get("paletteBias"),
        "source": "qwen",
        "labelZh": meta.get("labelZh"),
        "labelEn": meta.get("labelEn"),
        # Template hints are NOT applied as brush overrides — acoustics own variation.
        "modifiers": {},
        "brushHints": {},
    }


def brush_to_modifiers(brush: Mapping[str, Any]) -> Dict[str, float]:
    """Legacy VisualModifiers for UI / fusion path."""
    b = brush or {}
    return {
        "motionIntensity": clamp01(b.get("motion") or b.get("movementSpeed")),
        "turbulence": clamp01(b.get("turbulence")),
        "strokeComplexity": clamp01(b.get("detailScale") or b.get("edgeNoise")),
        "particleDensity": clamp01(b.get("particleDensity") or b.get("density")),
        "smoothness": clamp01(b.get("smoothness")),
        "organicFactor": clamp01(b.get("connectionStrength") or b.get("continuity")),
        "flowSpeed": clamp01(b.get("flow") or b.get("trailLength")),
        "spread": clamp01(b.get("expansion") or b.get("brushSize")),
        "continuity": clamp01(b.get("continuity")),
        "pulseStrength": clamp01(b.get("pulseRate") or b.get("rhythmStrength")),
        "rotationSpeed": clamp01(b.get("rotationSpeed") or b.get("pulseRate")),
        "scaleResponse": clamp01(b.get("scaleResponse") or b.get("brushSize")),
    }


def build_unified_brush_package(
    category: Optional[str],
    acoustic: Mapping[str, float],
) -> Dict[str, Any]:
    brush = map_acoustic_to_brush(category, acoustic)
    pattern = CATEGORY_TO_PATTERN.get(category) if category else None
    return {
        "category": category,
        "strokePattern": pattern,
        "acousticFeatures": {k: clamp01(acoustic.get(k, 0.0)) for k in (
            "rms", "peak", "spectralCentroid", "bassRatio", "midRatio", "trebleRatio",
            "spectralFlatness", "roughness", "spectralFlux", "tempo", "onsetDensity",
            "pulseRegularity", "silenceRatio", "continuity", "eventDuration",
        )},
        "brushParams": brush,
        "visualStructure": visual_structure_for_category(category),
        "visualModifiers": brush_to_modifiers(brush),
    }
