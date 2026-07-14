// Real-time FFT analyser for HTMLAudioElement playback.
// Used by SoundMembraneSphere for live audio-reactive visuals.
class PlaybackAnalyzer {
  constructor() {
    this.ctx = null;
    this.analyser = null;
    this.gain = null;
    this.source = null;
    this._mediaEl = null;
    this._freqData = null;
    this._prevFreq = null;
    this._prevLevel = 0;
    this._bassEnv = 0;
    this._trebleEnv = 0;
  }

  _clamp01(value) {
    const n = Number(value);
    return Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0));
  }

  _softCompress(value, knee = 0.22) {
    const x = Math.max(0, Number.isFinite(value) ? value : 0);
    return this._clamp01(x / (x + knee));
  }

  attachMediaElement(audioEl) {
    if (!audioEl) return;
    if (this._mediaEl === audioEl && this.source) return;

    this._teardownSource();

    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.48;
      this.gain = this.ctx.createGain();
      this.gain.gain.value = 1;
      this.analyser.connect(this.gain);
      this.gain.connect(this.ctx.destination);
    }

    this.source = this.ctx.createMediaElementSource(audioEl);
    this.source.connect(this.analyser);
    this._mediaEl = audioEl;
    this._resetBuffers();
  }

  attachAnalyserNode(analyser, audioCtx) {
    if (!analyser) return;
    this.analyser = analyser;
    this.ctx = audioCtx || this.ctx;
    this._mediaEl = null;
    this.source = null;
    analyser.smoothingTimeConstant = 0.48;
    this._resetBuffers();
  }

  _resetBuffers() {
    if (!this.analyser) return;
    this._freqData = new Uint8Array(this.analyser.frequencyBinCount);
    this._prevFreq = new Uint8Array(this.analyser.frequencyBinCount);
    this._prevLevel = 0;
    this._bassEnv = 0;
    this._trebleEnv = 0;
  }

  _teardownSource() {
    if (this.source) {
      try { this.source.disconnect(); } catch (e) { /* noop */ }
      this.source = null;
    }
    this._mediaEl = null;
  }

  detach() {
    this._teardownSource();
  }

  resume() {
    if (this.ctx && this.ctx.state === "suspended") {
      return this.ctx.resume();
    }
    return Promise.resolve();
  }

  readFeatures() {
    if (!this.analyser || !this._freqData) return null;

    this.analyser.getByteFrequencyData(this._freqData);
    const n = this._freqData.length;
    const subEnd = Math.max(1, Math.floor(n * 0.06));
    const bassEnd = Math.max(subEnd + 1, Math.floor(n * 0.16));
    const lowMidEnd = Math.max(bassEnd + 1, Math.floor(n * 0.32));
    const midEnd = Math.max(lowMidEnd + 1, Math.floor(n * 0.52));
    const highMidEnd = Math.max(midEnd + 1, Math.floor(n * 0.72));

    let sub = 0;
    let bass = 0;
    let lowMid = 0;
    let mid = 0;
    let highMid = 0;
    let treble = 0;
    let total = 0;

    for (let i = 0; i < n; i += 1) {
      const v = this._freqData[i] / 255;
      total += v;
      if (i < subEnd) sub += v;
      else if (i < bassEnd) bass += v;
      else if (i < lowMidEnd) lowMid += v;
      else if (i < midEnd) mid += v;
      else if (i < highMidEnd) highMid += v;
      else treble += v;
    }

    sub /= subEnd;
    bass /= Math.max(1, bassEnd - subEnd);
    lowMid /= Math.max(1, lowMidEnd - bassEnd);
    mid /= Math.max(1, midEnd - lowMidEnd);
    highMid /= Math.max(1, highMidEnd - midEnd);
    treble /= Math.max(1, n - highMidEnd);
    const level = total / n;

    // Keep band values in their natural range and use soft compression instead
    // of multiplying everything into a hard 1.0 ceiling.
    const bassMix = this._softCompress(sub * 0.82 + bass * 0.92, 0.18);
    const trebleMix = this._softCompress(highMid * 0.72 + treble * 0.96, 0.16);
    const midMix = this._softCompress(lowMid * 0.46 + mid * 0.70 + highMid * 0.28, 0.20);

    let flux = 0;
    if (this._prevFreq) {
      for (let i = 0; i < n; i += 4) {
        const d = (this._freqData[i] - this._prevFreq[i]) / 255;
        if (d > 0) flux += d;
      }
      flux /= Math.max(1, n / 4);
      this._prevFreq.set(this._freqData);
    }

    const levelJump = Math.max(0, level - this._prevLevel);
    this._prevLevel = level;

    // 峰值包络：快起慢落，让鼓点/镲片更有冲击感
    this._bassEnv = Math.max(bassMix, this._bassEnv * 0.8);
    this._trebleEnv = Math.max(trebleMix, this._trebleEnv * 0.76);

    return {
      bass: bassMix,
      lowMid: this._softCompress(lowMid * 0.62 + mid * 0.24, 0.22),
      mid: midMix,
      treble: trebleMix,
      bassPeak: this._clamp01(this._bassEnv),
      treblePeak: this._clamp01(this._trebleEnv),
      level: this._softCompress(level, 0.16),
      flux: this._softCompress(flux, 0.045),
      transient: this._clamp01(this._softCompress(levelJump, 0.035) * 0.55 + this._softCompress(flux, 0.045) * 0.38 + (bassMix + trebleMix) * 0.035)
    };
  }
}

window.PlaybackAnalyzer = PlaybackAnalyzer;
