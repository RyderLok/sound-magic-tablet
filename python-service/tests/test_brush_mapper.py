"""Qwen category chooses pattern; acoustics drive within-class brush differences."""
from brush_mapper import (
    BRUSH_RANGES,
    CATEGORY_TO_PATTERN,
    build_unified_brush_package,
    map_acoustic_to_brush,
)


def _feat(**overrides):
    base = {
        "rms": 0.4,
        "peak": 0.5,
        "spectralCentroid": 0.5,
        "bassRatio": 0.3,
        "midRatio": 0.4,
        "trebleRatio": 0.3,
        "spectralFlatness": 0.3,
        "roughness": 0.3,
        "spectralFlux": 0.3,
        "tempo": 0.4,
        "onsetDensity": 0.4,
        "pulseRegularity": 0.5,
        "silenceRatio": 0.3,
        "continuity": 0.5,
        "eventDuration": 0.4,
    }
    base.update(overrides)
    return base


def test_category_to_pattern():
    assert CATEGORY_TO_PATTERN["birds"] == "scatter_points"
    assert CATEGORY_TO_PATTERN["water"] == "wave_ripple"


def test_same_category_high_vs_low_treble_differs():
    high = map_acoustic_to_brush("birds", _feat(spectralCentroid=0.9, trebleRatio=0.85, bassRatio=0.1, rms=0.4))
    low = map_acoustic_to_brush("birds", _feat(spectralCentroid=0.2, trebleRatio=0.15, bassRatio=0.7, rms=0.4))
    assert high["particleSize"] < low["particleSize"]
    assert high["detailScale"] > low["detailScale"]
    assert high["movementSpeed"] > low["movementSpeed"]


def test_volume_does_not_dominate_density_and_motion():
    quiet = map_acoustic_to_brush("wind_leaves", _feat(rms=0.15, peak=0.2, onsetDensity=0.7, tempo=0.7, spectralCentroid=0.6))
    loud = map_acoustic_to_brush("wind_leaves", _feat(rms=0.9, peak=0.95, onsetDensity=0.7, tempo=0.7, spectralCentroid=0.6))
    # Size should rise with loudness; density/motion stay close (rhythm/freq owned).
    assert loud["brushSize"] > quiet["brushSize"]
    assert abs(loud["density"] - quiet["density"]) < 0.12
    assert abs(loud["movementSpeed"] - quiet["movementSpeed"]) < 0.12


def test_vibration_uses_roughness_more_than_rms():
    rough = map_acoustic_to_brush("birds", _feat(roughness=0.9, spectralFlux=0.8, rms=0.2, onsetDensity=0.2))
    smooth = map_acoustic_to_brush("birds", _feat(roughness=0.1, spectralFlux=0.1, rms=0.9, onsetDensity=0.2))
    assert rough["vibrationAmplitude"] > smooth["vibrationAmplitude"]
    assert "vibrationFrequency" in rough and "vibrationRandomness" in rough


def test_params_stay_in_category_ranges():
    b = map_acoustic_to_brush("birds", _feat(rms=1.0, peak=1.0, onsetDensity=1.0, spectralCentroid=1.0))
    for key, (lo, hi) in BRUSH_RANGES["birds"].items():
        if key in b:
            assert lo - 1e-6 <= b[key] <= hi + 1e-6, (key, b[key], lo, hi)


def test_unified_package_structure():
    pkg = build_unified_brush_package("water", _feat(continuity=0.9, silenceRatio=0.1))
    assert pkg["category"] == "water"
    assert pkg["strokePattern"] == "wave_ripple"
    assert "rms" in pkg["acousticFeatures"]
    assert pkg["brushParams"]["trailLength"] > map_acoustic_to_brush(
        "water", _feat(continuity=0.2, silenceRatio=0.8)
    )["trailLength"]


def test_no_category_still_returns_numeric_brush():
    b = map_acoustic_to_brush(None, _feat())
    assert 0 <= b["brushSize"] <= 1
    pkg = build_unified_brush_package(None, _feat())
    assert pkg["strokePattern"] is None
