"""Five natural-sound archetypes → acoustic signatures → visual structure (design doc §3)."""
from __future__ import annotations

from typing import Any, Dict, List, Mapping, Optional, Tuple

import numpy as np

from feature_normalizer import clamp01

ARCHETYPES: Dict[str, Dict[str, Any]] = {
    "birds": {
        "id": "birds",
        "labelZh": "鸟类",
        "labelEn": "Birds",
        "waveform": "稀疏、有节奏的短脉冲，静音段长",
        "spectrum": "中高频窄带能量（约 2–8 kHz 鸣叫）",
        "spectrogram": "时间上离散亮点，频率随 chirp 变化",
    },
    "wind_leaves": {
        "id": "wind_leaves",
        "labelZh": "风与树叶",
        "labelEn": "Wind & Leaves",
        "waveform": "连续、密、低幅度噪声纹理",
        "spectrum": "宽频噪声，能量较平坦",
        "spectrogram": "全频段持续雾状纹理",
    },
    "water": {
        "id": "water",
        "labelZh": "水",
        "labelEn": "Water",
        "waveform": "连续起伏，中等幅度，流动包络",
        "spectrum": "中低频为主，柔和滚降",
        "spectrogram": "缓慢漂移的宽带纹理带",
    },
    "material_impact": {
        "id": "material_impact",
        "labelZh": "自然材质交互",
        "labelEn": "Natural Material Interaction",
        "waveform": "突发高峰 + 快速衰减",
        "spectrum": "撞击瞬间全频带能量，随后迅速减弱",
        "spectrogram": "垂直冲击条纹后留白",
    },
    "insects_amphibians": {
        "id": "insects_amphibians",
        "labelZh": "昆虫与两栖动物",
        "labelEn": "Insects & Amphibians",
        "waveform": "高密度、等间隔重复脉冲",
        "spectrum": "中高频稳定 buzzing / 蛙鸣带",
        "spectrogram": "规律横纹或竖纹栅格",
    },
}

VISUAL_STRUCTURES: Dict[str, Dict[str, Any]] = {
    "birds": {
        "strokePattern": "scatter_points",
        "motionModel": "hop_discrete",
        "texturePattern": "stipple",
        "strokeBehavior": "dust",
        "paletteBias": "bright_warm",
        "modifiers": {
            "particleDensity": 0.35,
            "strokeComplexity": 0.72,
            "continuity": 0.25,
            "pulseStrength": 0.55,
            "spread": 0.45,
            "smoothness": 0.6,
            "organicFactor": 0.5,
            "flowSpeed": 0.4,
            "turbulence": 0.35,
        },
        "brushHints": {
            "density": 0.3,
            "turbulence": 0.35,
            "motion": 0.45,
            "continuity": 0.2,
            "smoothness": 0.65,
        },
    },
    "wind_leaves": {
        "strokePattern": "flow_field",
        "motionModel": "drift_continuous",
        "texturePattern": "noise_veil",
        "strokeBehavior": "flow",
        "paletteBias": "cool_muted",
        "modifiers": {
            "particleDensity": 0.55,
            "strokeComplexity": 0.35,
            "continuity": 0.88,
            "pulseStrength": 0.15,
            "spread": 0.5,
            "smoothness": 0.82,
            "organicFactor": 0.7,
            "flowSpeed": 0.25,
            "turbulence": 0.55,
        },
        "brushHints": {
            "density": 0.5,
            "turbulence": 0.6,
            "motion": 0.2,
            "continuity": 0.9,
            "smoothness": 0.85,
        },
    },
    "water": {
        "strokePattern": "wave_ripple",
        "motionModel": "oscillate_fluid",
        "texturePattern": "flow",
        "strokeBehavior": "flow",
        "paletteBias": "cool_blue_green",
        "modifiers": {
            "particleDensity": 0.48,
            "strokeComplexity": 0.42,
            "continuity": 0.75,
            "pulseStrength": 0.35,
            "spread": 0.55,
            "smoothness": 0.78,
            "organicFactor": 0.65,
            "flowSpeed": 0.38,
            "turbulence": 0.3,
        },
        "brushHints": {
            "density": 0.45,
            "turbulence": 0.28,
            "motion": 0.35,
            "continuity": 0.75,
            "smoothness": 0.8,
        },
    },
    "material_impact": {
        "strokePattern": "impact_burst",
        "motionModel": "impulse_decay",
        "texturePattern": "grain",
        "strokeBehavior": "burst",
        "paletteBias": "earth_contrast",
        "modifiers": {
            "particleDensity": 0.7,
            "strokeComplexity": 0.65,
            "continuity": 0.2,
            "pulseStrength": 0.92,
            "spread": 0.85,
            "smoothness": 0.35,
            "organicFactor": 0.45,
            "flowSpeed": 0.65,
            "turbulence": 0.75,
        },
        "brushHints": {
            "density": 0.75,
            "turbulence": 0.8,
            "motion": 0.7,
            "continuity": 0.15,
            "smoothness": 0.3,
        },
    },
    "insects_amphibians": {
        "strokePattern": "pulse_grid",
        "motionModel": "rhythmic_vibrate",
        "texturePattern": "buzz",
        "strokeBehavior": "pulse",
        "paletteBias": "mid_high_buzz",
        "modifiers": {
            "particleDensity": 0.62,
            "strokeComplexity": 0.58,
            "continuity": 0.55,
            "pulseStrength": 0.8,
            "spread": 0.4,
            "smoothness": 0.45,
            "organicFactor": 0.55,
            "flowSpeed": 0.5,
            "turbulence": 0.5,
            "rotationSpeed": 0.65,
        },
        "brushHints": {
            "density": 0.6,
            "turbulence": 0.55,
            "motion": 0.55,
            "continuity": 0.5,
            "smoothness": 0.4,
            "rotationSpeed": 0.7,
        },
    },
}


def _extra_metrics(y: np.ndarray, sr: int) -> Dict[str, float]:
    rms = float(np.sqrt(np.mean(y ** 2)) + 1e-9)
    peak = float(np.max(np.abs(y)) + 1e-9)
    crest = clamp01(peak / (rms * 4.0))
    frame = max(512, min(2048, len(y) // 8))
    silence_ratio = 0.0
    onset_regularity = 0.0
    spectral_flatness = 0.5
    onset_density = 0.0

    for i in range(0, max(1, len(y) - frame), frame):
        chunk = y[i : i + frame]
        if float(np.sqrt(np.mean(chunk ** 2))) < rms * 0.25:
            silence_ratio += 1.0
    silence_ratio = clamp01(silence_ratio / max(1, len(y) // frame))

    try:
        import librosa

        flat = librosa.feature.spectral_flatness(y=y)
        spectral_flatness = clamp01(float(np.mean(flat)))
        on_env = librosa.onset.onset_strength(y=y, sr=sr)
        onsets = librosa.onset.onset_detect(onset_envelope=on_env, sr=sr, units="time")
        onset_density = clamp01(len(onsets) / max(0.5, len(y) / sr) / 8.0)
        if len(onsets) >= 3:
            gaps = np.diff(onsets)
            cv = float(np.std(gaps) / (np.mean(gaps) + 1e-9))
            onset_regularity = clamp01(1.0 - min(cv, 1.0))
    except Exception:
        pass

    return {
        "crestFactor": crest,
        "silenceRatio": silence_ratio,
        "onsetRegularity": onset_regularity,
        "onsetDensity": onset_density,
        "spectralFlatness": spectral_flatness,
    }


def classify_natural_archetype(
    y: np.ndarray, sr: int, features: Mapping[str, Any]
) -> Dict[str, Any]:
    """Score each archetype; return best match + visual structure.

    Classes are program-mutually-exclusive (one winner) but not acoustically exclusive.
    When top-1 and top-2 scores are close, confidence is lowered and numeric template
    params are lightly blended toward the runner-up (strokePattern stays the winner's).
    """
    f = dict(features)
    extra = _extra_metrics(y, sr)
    metrics = {**f, **extra}
    if "continuity" not in metrics:
        metrics["continuity"] = clamp01(
            1.0 - metrics.get("zcr", 0) * 0.5 - metrics.get("spectralVariation", 0) * 0.5
        )

    scores: Dict[str, float] = {}

    scores["birds"] = clamp01(
        metrics.get("silenceRatio", 0) * 0.35
        + metrics.get("dynamicRange", 0) * 0.25
        + metrics.get("treble", 0) * 0.2
        + metrics.get("pitch", 0) * 0.15
        + (1 - metrics.get("continuity", 0.5)) * 0.05
    )
    scores["wind_leaves"] = clamp01(
        metrics.get("spectralFlatness", 0) * 0.3
        + metrics.get("roughness", 0) * 0.25
        + metrics.get("zcr", 0) * 0.2
        + (1 - metrics.get("dynamicRange", 0)) * 0.15
        + metrics.get("continuity", 0) * 0.1
    )
    scores["water"] = clamp01(
        metrics.get("mid", 0) * 0.28
        + metrics.get("bass", 0) * 0.22
        + (1 - metrics.get("roughness", 0)) * 0.22
        + metrics.get("continuity", 0) * 0.18
        + (1 - metrics.get("spectralFlatness", 0.5)) * 0.1
    )
    scores["material_impact"] = clamp01(
        metrics.get("crestFactor", 0) * 0.35
        + metrics.get("dynamicRange", 0) * 0.3
        + metrics.get("energy", 0) * 0.2
        + (1 - metrics.get("continuity", 0)) * 0.15
    )
    scores["insects_amphibians"] = clamp01(
        metrics.get("onsetRegularity", 0) * 0.35
        + metrics.get("onsetDensity", 0) * 0.25
        + metrics.get("tempo", 0) * 0.2
        + metrics.get("mid", 0) * 0.1
        + metrics.get("treble", 0) * 0.1
    )

    ranked: List[Tuple[str, float]] = sorted(scores.items(), key=lambda x: x[1], reverse=True)
    best_id, best_score = ranked[0]
    second_id, second_score = ranked[1] if len(ranked) > 1 else (None, 0.0)
    margin = float(best_score - second_score)

    # Close top-2 → lower reported confidence (score alone overstates certainty).
    confidence = _margin_adjusted_confidence(best_score, margin)
    ambiguous = margin < AMBIGUITY_MARGIN

    archetype = dict(ARCHETYPES[best_id])
    archetype["confidence"] = round(confidence, 3)
    archetype["rawScore"] = round(best_score, 3)
    archetype["margin"] = round(margin, 3)
    archetype["ambiguous"] = ambiguous
    archetype["runnerUpId"] = second_id
    archetype["runnerUpScore"] = round(float(second_score), 3)
    archetype["scores"] = {k: round(v, 3) for k, v in scores.items()}
    archetype["scoreGap"] = [
        {"id": k, "score": round(v, 3), "gapFromBest": round(best_score - v, 3)}
        for k, v in ranked
    ]
    archetype["metrics"] = {k: round(float(v), 3) for k, v in metrics.items() if k in {
        "crestFactor", "silenceRatio", "onsetRegularity", "onsetDensity",
        "spectralFlatness", "dynamicRange", "treble", "bass", "mid", "zcr", "tempo", "pitch",
    }}

    visual = build_visual_structure(
        best_id,
        metrics,
        confidence,
        second_id=second_id,
        margin=margin,
    )
    return {"archetype": archetype, "visualStructure": visual, "ranked": ranked}


# Below this margin, top-1 vs top-2 is treated as acoustically ambiguous.
AMBIGUITY_MARGIN = 0.08
# Max fraction of runner-up template mixed into numeric modifiers/hints.
BLEND_MAX = 0.35


def _margin_adjusted_confidence(best_score: float, margin: float) -> float:
    """Damp confidence when 1st/2nd place are close (e.g. 0.63 vs 0.59)."""
    # margin >= 0.15 → full best_score; margin → 0 → ~half certainty factor
    certainty = 0.5 + 0.5 * clamp01(margin / 0.15)
    return clamp01(float(best_score) * certainty)


def build_visual_structure(
    archetype_id: str,
    metrics: Mapping[str, Any],
    weight: float = 1.0,
    second_id: Optional[str] = None,
    margin: float = 1.0,
) -> Dict[str, Any]:
    """Blend archetype template with measured features for p5 brush assist.

    When margin is small, numeric modifiers/brushHints lean slightly toward the
    runner-up template. strokePattern / motionModel stay on the winner (stable brush family).
    """
    primary = _template_visual(archetype_id, metrics, weight)
    blend_w = 0.0
    if second_id and second_id != archetype_id and margin < AMBIGUITY_MARGIN:
        blend_w = clamp01(1.0 - margin / AMBIGUITY_MARGIN) * BLEND_MAX
        secondary = _template_visual(second_id, metrics, weight)
        primary["modifiers"] = _blend_numeric_maps(
            primary.get("modifiers") or {},
            secondary.get("modifiers") or {},
            blend_w,
        )
        primary["brushHints"] = _blend_numeric_maps(
            primary.get("brushHints") or {},
            secondary.get("brushHints") or {},
            blend_w,
        )
        primary["secondaryArchetypeId"] = second_id
        primary["secondaryStrokePattern"] = secondary.get("strokePattern")
        primary["secondaryMotionModel"] = secondary.get("motionModel")

    primary["ambiguous"] = bool(blend_w > 0)
    primary["blendWeight"] = round(float(blend_w), 3)
    primary["margin"] = round(float(margin), 3)
    return primary


def _template_visual(
    archetype_id: str, metrics: Mapping[str, Any], weight: float
) -> Dict[str, Any]:
    base = dict(VISUAL_STRUCTURES.get(archetype_id, VISUAL_STRUCTURES["water"]))
    w = clamp01(weight)
    mods = {}
    for k, v in base.get("modifiers", {}).items():
        measured = metrics.get(k.replace("flowSpeed", "tempo"), v)
        if k in ("particleDensity", "turbulence", "pulseStrength", "smoothness"):
            measured = metrics.get(
                {"particleDensity": "energy", "turbulence": "roughness",
                 "pulseStrength": "tempo", "smoothness": "spectralVariation"}.get(k, k),
                v,
            )
        mods[k] = round(clamp01(v * 0.65 + float(measured) * 0.35 * w), 3)

    brush = {}
    for k, v in base.get("brushHints", {}).items():
        brush[k] = mods.get(
            {"density": "particleDensity", "motion": "flowSpeed"}.get(k, k), v
        )

    return {
        "archetypeId": archetype_id,
        "strokePattern": base["strokePattern"],
        "motionModel": base["motionModel"],
        "texturePattern": base["texturePattern"],
        "strokeBehavior": base["strokeBehavior"],
        "paletteBias": base["paletteBias"],
        "modifiers": mods,
        "brushHints": brush,
        "acousticMapping": ARCHETYPES.get(archetype_id, {}),
    }


def _blend_numeric_maps(
    primary: Mapping[str, Any], secondary: Mapping[str, Any], t: float
) -> Dict[str, float]:
    """primary*(1-t) + secondary*t for shared numeric keys."""
    t = clamp01(t)
    keys = set(primary.keys()) | set(secondary.keys())
    out: Dict[str, float] = {}
    for k in keys:
        a = primary.get(k)
        b = secondary.get(k)
        if isinstance(a, (int, float)) and isinstance(b, (int, float)):
            out[k] = round(clamp01(float(a) * (1.0 - t) + float(b) * t), 3)
        elif isinstance(a, (int, float)):
            out[k] = round(clamp01(float(a)), 3)
        elif isinstance(b, (int, float)):
            out[k] = round(clamp01(float(b)), 3)
    return out
