// Console fingerprint for comparing recordings and catching stale acoustic data.
function logSoundFingerprint(name, features, acoustic) {
  const spectrum = acoustic?.spectrum ?? [];
  const spectrogram = acoustic?.spectrogram ?? [];
  const waveform = acoustic?.waveform ?? [];
  const shape = acoustic?.shapeProfile ?? {};

  const mean = (values) => values.length
    ? values.reduce((sum, value) => sum + Number(value || 0), 0) / values.length
    : 0;

  const flattenMean = (matrix) => {
    let sum = 0;
    let count = 0;
    for (const row of matrix ?? []) {
      for (const value of row ?? []) {
        sum += Number(value || 0);
        count += 1;
      }
    }
    return count ? sum / count : 0;
  };

  const peakAbs = (values) => values.length
    ? values.reduce((peak, value) => Math.max(peak, Math.abs(Number(value) || 0)), 0)
    : 0;

  console.table({
    name,
    bass: features?.bass ?? 0,
    mid: features?.mid ?? 0,
    treble: features?.treble ?? 0,
    volume: features?.volume ?? features?.energy ?? 0,
    roughness: features?.roughness ?? 0,
    spectralVariation: features?.spectralVariation ?? 0,
    waveformPeak: peakAbs(waveform),
    spectrumMean: mean(spectrum),
    spectrogramMean: flattenMean(spectrogram),
    waveformPoints: waveform.length,
    spectrumBins: spectrum.length,
    spectrogramRows: spectrogram.length,
    spectrogramColumns: spectrogram[0]?.length ?? 0,
    shapePlume: shape.plume ?? 0,
    shapeRibbon: shape.ribbon ?? 0,
    shapeRing: shape.ring ?? 0,
    shapeBurst: shape.burst ?? 0,
    shapeCluster: shape.cluster ?? 0,
    shapeSeed: shape.seed ?? 0
  });
}

window.logSoundFingerprint = logSoundFingerprint;
