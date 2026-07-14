// Offline audio analysis of an uploaded audio file (Blob or AudioBuffer).
// Extracts audio features via a pure-JavaScript FFT plus autocorrelation pitch
// and onset-based tempo detection, then splits the recording into three temporal
// sections so downstream layers (Sound Personality AI, Visual Mapping) can
// analyse the structure of the sound over time.
class SampleAnalyzer {
  constructor() {
    this.fftSize = 2048;
  }

  // Decode a Blob and run the full analysis.
  async analyze(blob) {
    const arrayBuffer = await blob.arrayBuffer();
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    let audioBuffer;
    try {
      audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    } finally {
      audioContext.close().catch(() => {});
    }
    return this.analyzeBuffer(audioBuffer);
  }

  // Analyse a decoded AudioBuffer directly (used from app.js after file decode).
  analyzeBuffer(audioBuffer) {
    const numChannels = audioBuffer.numberOfChannels;
    const length = audioBuffer.length;
    const sampleRate = audioBuffer.sampleRate;

    // Mix all channels down to mono.
    const data = new Float32Array(length);
    for (let c = 0; c < numChannels; c++) {
      const ch = audioBuffer.getChannelData(c);
      for (let i = 0; i < length; i++) data[i] += ch[i] / numChannels;
    }

    const features = this.extractFullFeatures(data, sampleRate);
    const acoustic = this.extractAcousticPayload(data, sampleRate);

    // Temporal analysis: split into three equal thirds.
    const third = Math.floor(length / 3);
    const sections = {
      beginning: this.extractFullFeatures(data.slice(0, third), sampleRate),
      middle: this.extractFullFeatures(data.slice(third, 2 * third), sampleRate),
      end: this.extractFullFeatures(data.slice(2 * third), sampleRate)
    };

    return { ...features, sections, duration: audioBuffer.duration, acoustic };
  }

  // ---- Core feature extraction ---------------------------------------------

  extractFullFeatures(data, sampleRate) {
    const N = data.length;
    if (N < 64) return this.emptyFeatures();

    // RMS volume + peak.
    let sumSq = 0;
    let peak = 0;
    for (let i = 0; i < N; i++) {
      sumSq += data[i] * data[i];
      const a = Math.abs(data[i]);
      if (a > peak) peak = a;
    }
    const rms = Math.sqrt(sumSq / N);
    const volume = this.clamp01(rms / 0.22);

    // Dynamic range: peak-to-RMS ratio in dB, normalised to 0-1 over a 0-40 dB range.
    const dynamicRange = rms > 0.0001
      ? this.clamp01((20 * Math.log10(peak / rms)) / 40)
      : 0;

    // Zero-crossing rate → roughness proxy.
    let zcCount = 0;
    for (let i = 1; i < N; i++) {
      if ((data[i] >= 0) !== (data[i - 1] >= 0)) zcCount++;
    }
    const roughness = this.clamp01((zcCount / N) / 0.12);

    // Overlapping Hann-windowed FFT spectral analysis.
    const winSize = Math.min(this.fftSize, this.prevPow2(N));
    const hop = winSize >> 1;
    const numWindows = Math.max(1, Math.floor((N - winSize) / hop) + 1);
    const binHz = sampleRate / winSize;
    const bassEndBin = Math.min(Math.floor(250 / binHz), (winSize >> 1) - 1);
    const midEndBin = Math.min(Math.floor(4000 / binHz), (winSize >> 1) - 1);

    let bassE = 0, midE = 0, trebleE = 0;
    let centNum = 0, centDen = 0;
    const specSum = new Float32Array(winSize >> 1);
    const frameCentroids = [];
    const re = new Float32Array(winSize);
    const im = new Float32Array(winSize);

    for (let w = 0; w < numWindows; w++) {
      const start = w * hop;
      for (let k = 0; k < winSize; k++) {
        const hann = 0.5 * (1 - Math.cos((2 * Math.PI * k) / (winSize - 1)));
        re[k] = (start + k < N ? data[start + k] : 0) * hann;
        im[k] = 0;
      }
      this.fft(re, im);

      let fCentNum = 0;
      let fCentDen = 0;
      for (let b = 0; b < (winSize >> 1); b++) {
        const mag = Math.sqrt(re[b] * re[b] + im[b] * im[b]);
        specSum[b] += mag;
        centNum += mag * b;
        centDen += mag;
        fCentNum += mag * b;
        fCentDen += mag;
        if (b <= bassEndBin) bassE += mag;
        else if (b <= midEndBin) midE += mag;
        else trebleE += mag;
      }
      if (fCentDen > 0) frameCentroids.push(fCentNum / fCentDen);
    }

    const totalBand = bassE + midE + trebleE + 1e-10;
    const bass = this.clamp01(bassE / totalBand);
    const mid = this.clamp01(midE / totalBand);
    const treble = this.clamp01(trebleE / totalBand);
    const brightness = this.clamp01(centDen > 0 ? (centNum / centDen) / ((winSize >> 1) * 0.5) : 0);
    const energy = this.clamp01(volume * 0.45 + bass * 0.2 + mid * 0.2 + treble * 0.15);

    // Spectral variation: standard deviation of per-frame spectral centroids.
    let cmean = 0;
    for (const c of frameCentroids) cmean += c;
    cmean /= Math.max(1, frameCentroids.length);
    let cvar = 0;
    for (const c of frameCentroids) cvar += (c - cmean) ** 2;
    const spectralVariation = this.clamp01(
      Math.sqrt(cvar / Math.max(1, frameCentroids.length)) / (winSize >> 2)
    );

    // Pitch and tempo.
    const pitch = this.estimatePitch(data, sampleRate);
    const tempo = this.estimateTempo(data, sampleRate);

    // Fixed-reference spectrum profile for canvas and morphology. Avoid
    // per-recording peak normalization, which makes different clips look alike.
    const profileSize = 128;
    const spectrumProfile = new Array(profileSize);
    const binStep = specSum.length / profileSize;
    for (let i = 0; i < profileSize; i++) {
      let v = 0;
      const from = Math.floor(i * binStep);
      const to = Math.ceil((i + 1) * binStep);
      for (let b = from; b < to && b < specSum.length; b++) v += specSum[b];
      const avg = v / Math.max(1, (to - from) * numWindows);
      spectrumProfile[i] = this.softCompress(avg, 0.035);
    }

    return {
      volume, bass, mid, treble, brightness, energy, roughness,
      dynamicRange, spectralVariation, pitch, tempo, spectrumProfile
    };
  }

  emptyFeatures() {
    return {
      volume: 0, bass: 0, mid: 0, treble: 0, brightness: 0, energy: 0,
      roughness: 0, dynamicRange: 0, spectralVariation: 0, pitch: 0.1, tempo: 0.5,
      spectrumProfile: new Array(128).fill(0)
    };
  }

  extractAcousticPayload(data, sampleRate) {
    const N = data.length;
    if (N < 64) {
      return {
        waveform: Array.from(data || []),
        spectrum: [],
        spectrogram: [],
        frameFeatures: [],
        sampleRate,
        duration: N / Math.max(1, sampleRate)
      };
    }

    const waveformCount = Math.min(1200, Math.max(256, N));
    const waveform = new Array(waveformCount);
    for (let i = 0; i < waveformCount; i += 1) {
      waveform[i] = data[Math.floor((i / Math.max(1, waveformCount - 1)) * (N - 1))] || 0;
    }

    const winSize = Math.min(this.fftSize, this.prevPow2(N));
    const hop = Math.max(128, winSize >> 2);
    const frameCount = Math.max(1, Math.floor((N - winSize) / hop) + 1);
    const half = winSize >> 1;
    const re = new Float32Array(winSize);
    const im = new Float32Array(winSize);
    const specSum = new Float32Array(half);
    const rawFrames = [];
    const frameFeatures = [];

    for (let frame = 0; frame < frameCount; frame += 1) {
      const start = frame * hop;
      let rmsSum = 0;
      for (let k = 0; k < winSize; k += 1) {
        const sample = start + k < N ? data[start + k] : 0;
        const hann = 0.5 * (1 - Math.cos((2 * Math.PI * k) / (winSize - 1)));
        re[k] = sample * hann;
        im[k] = 0;
        rmsSum += sample * sample;
      }
      this.fft(re, im);

      const mags = new Float32Array(half);
      let total = 1e-9;
      let centroid = 0;
      for (let b = 0; b < half; b += 1) {
        const mag = Math.sqrt(re[b] * re[b] + im[b] * im[b]);
        mags[b] = mag;
        specSum[b] += mag;
        total += mag;
        centroid += mag * (half > 1 ? b / (half - 1) : 0);
      }
      rawFrames.push(mags);
      frameFeatures.push({
        time: start / sampleRate,
        rms: this.clamp01(Math.sqrt(rmsSum / winSize) / 0.35),
        centroid: this.clamp01(centroid / total),
        flux: 0
      });
    }

    for (let frame = 1; frame < rawFrames.length; frame += 1) {
      let positive = 0;
      let normalizer = 1e-9;
      const prev = rawFrames[frame - 1];
      const cur = rawFrames[frame];
      for (let b = 0; b < cur.length; b += 1) {
        positive += Math.max(0, cur[b] - prev[b]);
        normalizer += Math.max(cur[b], prev[b]);
      }
      frameFeatures[frame].flux = this.softCompress(positive / normalizer, 0.08);
    }

    const spectrumBins = Math.min(256, half);
    const spectrum = new Array(spectrumBins);
    for (let i = 0; i < spectrumBins; i += 1) {
      const from = Math.floor((i / spectrumBins) * half);
      const to = Math.max(from + 1, Math.floor(((i + 1) / spectrumBins) * half));
      let sum = 0;
      for (let b = from; b < to; b += 1) sum += specSum[b];
      spectrum[i] = this.softCompress(sum / Math.max(1, (to - from) * frameCount), 0.035);
    }

    const rows = Math.min(96, half);
    const cols = Math.min(180, rawFrames.length);
    const spectrogram = [];
    for (let r = 0; r < rows; r += 1) {
      const row = [];
      const sourceBin = Math.floor((r / Math.max(1, rows - 1)) * (half - 1));
      for (let c = 0; c < cols; c += 1) {
        const sourceFrame = Math.floor((c / Math.max(1, cols - 1)) * (rawFrames.length - 1));
        row.push(this.softCompress(rawFrames[sourceFrame][sourceBin], 0.035));
      }
      spectrogram.push(row);
    }

    return {
      waveform,
      spectrum,
      spectrogram,
      frameFeatures,
      sampleRate,
      duration: N / Math.max(1, sampleRate)
    };
  }

  // ---- Pitch estimation (autocorrelation, first 4096 samples) ---------------

  estimatePitch(data, sampleRate) {
    const N = Math.min(4096, data.length);
    const minLag = Math.max(1, Math.floor(sampleRate / 2000)); // max 2 kHz
    const maxLag = Math.min(Math.floor(sampleRate / 50), N - 1); // min 50 Hz
    if (maxLag <= minLag) return 0.1;

    let sumSq = 0;
    for (let i = 0; i < N; i++) sumSq += data[i] * data[i];
    if (sumSq < 0.0001) return 0.1;

    let bestLag = -1;
    let bestCorr = -1;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let corr = 0;
      for (let i = 0; i < N - lag; i++) corr += data[i] * data[i + lag];
      corr /= sumSq;
      if (corr > bestCorr) { bestCorr = corr; bestLag = lag; }
    }

    if (bestLag > 0 && bestCorr > 0.25) {
      return this.clamp01((sampleRate / bestLag - 50) / 1950);
    }
    return 0.1;
  }

  // ---- Tempo estimation (onset detection on first 30 s) ---------------------

  estimateTempo(data, sampleRate) {
    const frameSize = Math.floor(sampleRate * 0.05);  // 50 ms frames
    const hopSize = Math.floor(sampleRate * 0.025);   // 25 ms hop
    const maxSamples = Math.min(data.length, sampleRate * 30);
    const numFrames = Math.max(4, Math.floor((maxSamples - frameSize) / hopSize));

    const energies = [];
    for (let f = 0; f < numFrames; f++) {
      const start = f * hopSize;
      let sum = 0;
      for (let i = 0; i < frameSize && start + i < maxSamples; i++) {
        sum += data[start + i] ** 2;
      }
      energies.push(Math.sqrt(sum / frameSize));
    }

    // Positive energy flux (onset strength).
    const onsets = [0];
    for (let f = 1; f < energies.length; f++) {
      onsets.push(Math.max(0, energies[f] - energies[f - 1]));
    }

    // Autocorrelate the onset function for each candidate BPM.
    let bestBPM = 120;
    let bestScore = -Infinity;
    const hopMs = 25;
    for (let bpm = 60; bpm <= 180; bpm += 2) {
      const periodFrames = Math.round((60 / bpm) / (hopMs / 1000));
      if (periodFrames < 1 || periodFrames >= onsets.length) continue;
      let score = 0;
      for (let i = 0; i < onsets.length - periodFrames; i++) {
        score += onsets[i] * onsets[i + periodFrames];
      }
      if (score > bestScore) { bestScore = score; bestBPM = bpm; }
    }

    // Normalise: 60 BPM = 0, 180 BPM = 1.
    return this.clamp01((bestBPM - 60) / 120);
  }

  // ---- Cooley-Tukey radix-2 in-place FFT (power-of-2 length) ---------------

  fft(re, im) {
    const n = re.length;
    let j = 0;
    for (let i = 1; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        let t;
        t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = (-2 * Math.PI) / len;
      const wRe = Math.cos(ang);
      const wIm = Math.sin(ang);
      const half = len >> 1;
      for (let i = 0; i < n; i += len) {
        let curRe = 1;
        let curIm = 0;
        for (let k = 0; k < half; k++) {
          const uRe = re[i + k];
          const uIm = im[i + k];
          const vRe = re[i + k + half] * curRe - im[i + k + half] * curIm;
          const vIm = re[i + k + half] * curIm + im[i + k + half] * curRe;
          re[i + k] = uRe + vRe;
          im[i + k] = uIm + vIm;
          re[i + k + half] = uRe - vRe;
          im[i + k + half] = uIm - vIm;
          const nr = curRe * wRe - curIm * wIm;
          curIm = curRe * wIm + curIm * wRe;
          curRe = nr;
        }
      }
    }
  }

  prevPow2(n) {
    if (n <= 0) return 1;
    let p = 1;
    while (p * 2 <= n) p *= 2;
    return p;
  }

  clamp01(v) { return Math.min(1, Math.max(0, v || 0)); }
  softCompress(v, knee = 0.2) {
    const x = Math.max(0, Number.isFinite(v) ? v : 0);
    return this.clamp01(x / (x + knee));
  }
}

window.SampleAnalyzer = SampleAnalyzer;
