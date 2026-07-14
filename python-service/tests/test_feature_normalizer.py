from feature_normalizer import clamp01, normalize_features


def test_clamp01():
    assert clamp01(1.5) == 1.0
    assert clamp01(-0.2) == 0.0
    assert clamp01("bad", 0.3) == 0.3


def test_normalize_features_defaults():
    f = normalize_features({})
    assert f["volume"] == 0.0
    assert f["spectrumProfile"] == []


def test_normalize_features_aliases():
    f = normalize_features({"brightness": 0.8, "roughness": 0.4})
    assert f["spectralCentroid"] == 0.8
    assert f["spectralVariation"] == 0.4
