// Waveform + spectrum + spectrogram driver for SoundMembraneSphere.
// This does not decode or analyse audio; it consumes the existing acoustic
// payload and turns it into stable per-frame visual controls.
class AcousticBreathingDriver {
  constructor(acoustic = {}, options = {}) {
    this.loop = options.loop ?? true;
    this.playbackTimeProvider = options.playbackTimeProvider ?? null;
    this._previousColumn = null;
    this.setAcoustic(acoustic);
  }

  static clamp01(value) {
    const n = Number(value);
    return Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));
  }

  static softCompress(value, knee = 0.35) {
    const x = Math.max(0, Number.isFinite(value) ? value : 0);
    return x / (x + knee);
  }

  static mix(a, b, t) {
    return a + (b - a) * t;
  }

  setAcoustic(acoustic = {}) {
    this.waveform = Float32Array.from(acoustic.waveform ?? []);
    this.spectrum = Float32Array.from(acoustic.spectrum ?? []);
    this.spectrogram = Array.isArray(acoustic.spectrogram)
      ? acoustic.spectrogram.map((row) => Float32Array.from(row ?? []))
      : [];
    this.frameFeatures = Array.isArray(acoustic.frameFeatures) ? acoustic.frameFeatures : [];
    this.shapeProfile = this._sanitizeShapeProfile(acoustic.shapeProfile);
    this.duration = Math.max(0.001, Number(acoustic.duration) || Number(acoustic.audioDuration) || 1);
    this.sampleRate = Number(acoustic.sampleRate) || 0;
    this._previousColumn = null;
    this.signature = this._buildStaticSignature();
  }

  _sanitizeShapeProfile(shapeProfile) {
    const src = shapeProfile || {};
    const out = {};
    [
      "plume", "ribbon", "ring", "burst", "cluster",
      "stretchX", "stretchY", "stretchZ", "taper", "twist",
      "branchiness", "fragmentation", "roughness", "density", "noiseScale"
    ].forEach((key) => {
      out[key] = AcousticBreathingDriver.clamp01(src[key]);
    });
    const seed = Number(src.seed);
    out.seed = Number.isFinite(seed) ? seed : 0;
    return out;
  }

  _sampleWaveEnvelope(progress, radius = 8) {
    const values = this.waveform;
    if (!values.length) return { envelope: 0, slope: 0, crest: 0 };

    const center = Math.round(AcousticBreathingDriver.clamp01(progress) * (values.length - 1));
    let sum = 0;
    let peak = 0;
    let count = 0;

    for (let offset = -radius; offset <= radius; offset += 1) {
      const index = Math.max(0, Math.min(values.length - 1, center + offset));
      const magnitude = Math.abs(values[index]);
      sum += magnitude;
      peak = Math.max(peak, magnitude);
      count += 1;
    }

    const envelopeRaw = sum / Math.max(1, count);
    const before = Math.abs(values[Math.max(0, center - 2)]);
    const after = Math.abs(values[Math.min(values.length - 1, center + 2)]);
    const slope = Math.max(-1, Math.min(1, (after - before) * 3));
    const crest = peak / Math.max(1e-6, envelopeRaw);

    return {
      envelope: AcousticBreathingDriver.clamp01(AcousticBreathingDriver.softCompress(envelopeRaw, 0.18)),
      slope,
      crest: AcousticBreathingDriver.clamp01((crest - 1) / 5)
    };
  }

  _getSpectrogramColumn(progress) {
    if (!this.spectrogram.length) return new Float32Array(0);
    const timeLength = Math.max(0, ...this.spectrogram.map((row) => row.length));
    if (!timeLength) return new Float32Array(0);

    const timeIndex = Math.min(
      timeLength - 1,
      Math.round(AcousticBreathingDriver.clamp01(progress) * (timeLength - 1))
    );
    const column = new Float32Array(this.spectrogram.length);
    for (let i = 0; i < this.spectrogram.length; i += 1) {
      const row = this.spectrogram[i];
      column[i] = row.length ? row[Math.min(timeIndex, row.length - 1)] : 0;
    }
    return column;
  }

  _bandEnergies(values, bandCount = 4) {
    const result = new Float32Array(bandCount);
    if (!values?.length) return result;

    let total = 0;
    for (let i = 0; i < values.length; i += 1) {
      const value = Math.max(0, values[i]);
      const band = Math.min(bandCount - 1, Math.floor((i / values.length) * bandCount));
      result[band] += value;
      total += value;
    }

    if (total > 1e-8) {
      for (let i = 0; i < result.length; i += 1) result[i] /= total;
    }
    return result;
  }

  _distributionStats(values) {
    if (!values?.length) return { energy: 0, centroid: 0, spread: 0, entropy: 0 };

    let sum = 0;
    let weighted = 0;
    for (let i = 0; i < values.length; i += 1) {
      const value = Math.max(0, values[i]);
      const position = values.length > 1 ? i / (values.length - 1) : 0;
      sum += value;
      weighted += value * position;
    }
    if (sum <= 1e-8) return { energy: 0, centroid: 0, spread: 0, entropy: 0 };

    const centroid = weighted / sum;
    let variance = 0;
    let entropy = 0;
    for (let i = 0; i < values.length; i += 1) {
      const value = Math.max(0, values[i]);
      const probability = value / sum;
      const position = values.length > 1 ? i / (values.length - 1) : 0;
      variance += probability * (position - centroid) ** 2;
      if (probability > 1e-8) entropy -= probability * Math.log(probability);
    }

    return {
      energy: AcousticBreathingDriver.clamp01(AcousticBreathingDriver.softCompress(sum / values.length, 0.22)),
      centroid: AcousticBreathingDriver.clamp01(centroid),
      spread: AcousticBreathingDriver.clamp01(Math.sqrt(variance) * 2.6),
      entropy: AcousticBreathingDriver.clamp01(entropy / Math.log(Math.max(2, values.length)))
    };
  }

  _spectralFlux(column) {
    if (!column.length) return 0;
    if (!this._previousColumn || this._previousColumn.length !== column.length) {
      this._previousColumn = Float32Array.from(column);
      return 0;
    }

    let positiveChange = 0;
    let normalizer = 0;
    for (let i = 0; i < column.length; i += 1) {
      positiveChange += Math.max(0, column[i] - this._previousColumn[i]);
      normalizer += Math.max(column[i], this._previousColumn[i]);
    }
    this._previousColumn.set(column);
    return AcousticBreathingDriver.clamp01(
      AcousticBreathingDriver.softCompress(positiveChange / Math.max(1e-6, normalizer), 0.08)
    );
  }

  _buildStaticSignature() {
    const bands = this._bandEnergies(this.spectrum, 4);
    const stats = this._distributionStats(this.spectrum);
    return {
      low: bands[0] ?? 0,
      lowMid: bands[1] ?? 0,
      highMid: bands[2] ?? 0,
      air: bands[3] ?? 0,
      centroid: stats.centroid,
      spread: stats.spread,
      entropy: stats.entropy,
      energy: stats.energy
    };
  }

  _resolveProgress(timeSeconds) {
    const providedTime = this.playbackTimeProvider?.();
    const time = Number.isFinite(providedTime) ? providedTime : timeSeconds;
    if (this.loop) return (((time % this.duration) + this.duration) % this.duration) / this.duration;
    return AcousticBreathingDriver.clamp01(time / this.duration);
  }

  update(timeSeconds) {
    const progress = this._resolveProgress(timeSeconds);
    const wave = this._sampleWaveEnvelope(progress);
    const column = this._getSpectrogramColumn(progress);
    const timeBands = this._bandEnergies(column, 4);
    const timeStats = this._distributionStats(column);
    const flux = this._spectralFlux(column);

    const low = AcousticBreathingDriver.mix(this.signature.low, timeBands[0] ?? 0, 0.68);
    const lowMid = AcousticBreathingDriver.mix(this.signature.lowMid, timeBands[1] ?? 0, 0.68);
    const highMid = AcousticBreathingDriver.mix(this.signature.highMid, timeBands[2] ?? 0, 0.68);
    const air = AcousticBreathingDriver.mix(this.signature.air, timeBands[3] ?? 0, 0.68);
    const level = AcousticBreathingDriver.clamp01(wave.envelope * 0.62 + timeStats.energy * 0.38);
    const transient = AcousticBreathingDriver.clamp01(
      flux * 0.72 + Math.max(0, wave.slope) * 0.18 + wave.crest * 0.10
    );

    return {
      progress,
      waveform: { envelope: wave.envelope, slope: wave.slope, crest: wave.crest },
      spectrogram: {
        low, lowMid, highMid, air,
        energy: timeStats.energy,
        centroid: timeStats.centroid,
        spread: timeStats.spread,
        entropy: timeStats.entropy,
        flux
      },
      spectrum: this.signature,
      audioState: {
        bass: AcousticBreathingDriver.clamp01(low * 1.08),
        lowMid: AcousticBreathingDriver.clamp01(lowMid * 1.10),
        mid: AcousticBreathingDriver.clamp01(lowMid * 0.42 + highMid * 0.74),
        treble: AcousticBreathingDriver.clamp01(highMid * 0.42 + air * 0.96),
        level,
        flux,
        transient
      },
      shaderState: {
        waveEnvelope: wave.envelope,
        waveSlope: wave.slope,
        spectrumBands: [this.signature.low, this.signature.lowMid, this.signature.highMid, this.signature.air],
        spectrogramBands: [low, lowMid, highMid, air],
        spectralCentroid: AcousticBreathingDriver.mix(this.signature.centroid, timeStats.centroid, 0.72),
        spectralSpread: AcousticBreathingDriver.mix(this.signature.spread, timeStats.spread, 0.72),
        spectralEntropy: AcousticBreathingDriver.mix(this.signature.entropy, timeStats.entropy, 0.72)
      }
    };
  }
}

window.AcousticBreathingDriver = AcousticBreathingDriver;
