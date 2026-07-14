// Unified feature schema — ESP32, JS SampleAnalyzer, Python enhancement.
const FEATURE_KEYS = [
  "volume", "energy", "brightness", "roughness", "pitch", "tempo",
  "spectralCentroid", "zcr", "dynamicRange", "spectralVariation",
  "bass", "mid", "treble"
];

const MODIFIER_KEYS = [
  "motionIntensity", "turbulence", "strokeComplexity", "particleDensity",
  "smoothness", "organicFactor", "flowSpeed", "spread", "continuity",
  "pulseStrength", "rotationSpeed", "scaleResponse"
];

function clamp01(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(1, Math.max(0, n));
}

function emptyFeatures() {
  const f = { spectrumProfile: [] };
  FEATURE_KEYS.forEach(k => { f[k] = 0; });
  return f;
}

function normalizeProfile(profile) {
  if (!profile || !profile.length) return [];
  return Array.from(profile).slice(0, 128).map(v => {
    const n = Number(v);
    if (!Number.isFinite(n)) return 0;
    return clamp01(n > 1 ? n / 255 : n);
  });
}

function normalizeFeatures(raw) {
  const src = raw || {};
  const out = emptyFeatures();

  FEATURE_KEYS.forEach(key => {
    out[key] = clamp01(src[key], out[key]);
  });

  if (src.spectralCentroid !== undefined) out.spectralCentroid = clamp01(src.spectralCentroid);
  else if (src.brightness !== undefined) out.spectralCentroid = clamp01(src.brightness);

  if (src.spectralVariation !== undefined) out.spectralVariation = clamp01(src.spectralVariation);
  else if (src.roughness !== undefined) out.spectralVariation = clamp01(src.roughness);

  out.spectrumProfile = normalizeProfile(src.spectrumProfile);
  return out;
}

function fromEsp32Adapter(adapter) {
  if (!adapter) return emptyFeatures();
  const af = adapter.toAnalyzerFeatures ? adapter.toAnalyzerFeatures() : {};
  const n = adapter.getNormalized ? adapter.getNormalized() : {};
  return normalizeFeatures({
    volume: af.volume ?? n.level,
    energy: af.energy,
    brightness: af.brightness,
    roughness: af.roughness,
    bass: af.bass,
    mid: af.mid,
    treble: af.treble,
    spectralCentroid: af.brightness,
    spectralVariation: af.roughness,
    pitch: af.brightness * 0.6 + af.treble * 0.4,
    tempo: af.roughness * 0.5 + af.volume * 0.5,
    zcr: af.roughness * 0.7,
    dynamicRange: n.peak
  });
}

function fromEsp32MetricsSeries(series) {
  if (!series || series.length < 2) return null;
  if (typeof extractFeaturesFromEsp32Metrics === "function") {
    return normalizeFeatures(extractFeaturesFromEsp32Metrics(series));
  }
  return null;
}

function fromSampleAnalyzer(output) {
  return normalizeFeatures(output || {});
}

function fromPythonResult(result) {
  if (!result) return emptyFeatures();
  return normalizeFeatures(result.features || result);
}

function mergeFeatures(base, overlay, weight = 0.6) {
  const w = clamp01(weight, 0.6);
  const a = normalizeFeatures(base);
  const b = normalizeFeatures(overlay);
  const merged = emptyFeatures();

  FEATURE_KEYS.forEach(key => {
    merged[key] = clamp01(a[key] * (1 - w) + b[key] * w);
  });

  const len = Math.max(a.spectrumProfile.length, b.spectrumProfile.length, 1);
  merged.spectrumProfile = [];
  for (let i = 0; i < Math.min(len, 128); i++) {
    const av = a.spectrumProfile[i] || 0;
    const bv = b.spectrumProfile[i] || 0;
    merged.spectrumProfile.push(clamp01(av * (1 - w) + bv * w));
  }
  return merged;
}

window.FeatureSchema = {
  FEATURE_KEYS,
  MODIFIER_KEYS,
  clamp01,
  emptyFeatures,
  normalizeFeatures,
  normalizeProfile,
  fromEsp32Adapter,
  fromEsp32MetricsSeries,
  fromSampleAnalyzer,
  fromPythonResult,
  mergeFeatures
};
