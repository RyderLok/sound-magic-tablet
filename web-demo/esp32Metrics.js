// ESP32 hardware metrics → WAV + audio features (for legacy volume-only sketches).
function normalizeMetricSeries(samples) {
  if (!samples || !samples.length) return [];
  const maxLevel = Math.max(...samples.map(s => s.level), 0.02);
  const maxPeak = Math.max(...samples.map(s => s.peak), 0.02);
  return samples.map(s => ({
    t: s.t,
    level: s.level / maxLevel,
    peak: s.peak / maxPeak,
    volumePct: s.volumePct
  }));
}

function extractFeaturesFromEsp32Metrics(samples) {
  const series = normalizeMetricSeries(samples);
  if (series.length < 2) return null;

  const levels = series.map(s => s.level);
  const peaks = series.map(s => s.peak);
  const avg = levels.reduce((a, b) => a + b, 0) / levels.length;
  const maxL = Math.max(...levels);
  const minL = Math.min(...levels);
  const maxP = Math.max(...peaks);

  let flux = 0;
  for (let i = 1; i < levels.length; i++) {
    flux += Math.abs(levels[i] - levels[i - 1]);
  }
  flux /= Math.max(1, levels.length - 1);

  const clamp01 = v => Math.min(1, Math.max(0, v));
  const volume = clamp01(avg * 0.85 + maxL * 0.15);
  const bass = clamp01(avg * 0.9 + maxL * 0.1);
  const mid = clamp01(avg * 0.55 + flux * 0.45);
  const treble = clamp01(maxP * 0.75 + flux * 0.25);

  const spectrumProfile = new Float32Array(128);
  for (let i = 0; i < 128; i++) {
    const t = i / 127;
    const low = bass * (1 - t * 0.8);
    const high = treble * t;
    spectrumProfile[i] = Math.min(255, (low * 0.65 + high * 0.35 + mid * 0.2) * 255);
  }

  return {
    volume,
    bass,
    mid,
    treble,
    brightness: clamp01(maxP * 0.6 + flux * 0.4),
    energy: clamp01(volume * 0.5 + maxP * 0.35 + bass * 0.15),
    roughness: clamp01(flux * 1.2),
    pitch: clamp01(0.15 + maxP * 0.55 + avg * 0.2),
    tempo: clamp01(flux * 0.8 + avg * 0.2),
    dynamicRange: clamp01((maxL - minL) / Math.max(maxL, 0.01)),
    spectrumProfile
  };
}

async function metricsToAudioBuffer(samples, sampleRate, audioContext) {
  const normalized = normalizeMetricSeries(samples);
  const blob = synthesizeWavFromMetrics(normalized, sampleRate);
  if (!blob) return null;
  const ab = await blob.arrayBuffer();
  return audioContext.decodeAudioData(ab.slice(0));
}

window.normalizeMetricSeries = normalizeMetricSeries;
window.extractFeaturesFromEsp32Metrics = extractFeaturesFromEsp32Metrics;
window.metricsToAudioBuffer = metricsToAudioBuffer;
