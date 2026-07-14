// Build 16-bit mono WAV Blob from PCM byte chunks (little-endian int16).
function processEsp32PcmBytes(pcmBytes, sampleRate = 16000) {
  const n = Math.floor(pcmBytes.length / 2);
  if (n < 128) return pcmBytes;

  const view = new DataView(pcmBytes.buffer, pcmBytes.byteOffset, pcmBytes.byteLength);
  const raw = new Float32Array(n);
  for (let i = 0; i < n; i++) raw[i] = view.getInt16(i * 2, true);

  // Drop first ~120ms — I2S startup blur
  const trim = Math.min(Math.floor(sampleRate * 0.12), Math.floor(n * 0.08));
  const len = n - trim;
  if (len < 128) return pcmBytes;

  let sum = 0;
  for (let i = trim; i < n; i++) sum += raw[i];
  const dc = sum / len;

  // High-pass ~130Hz removes rumble / DC hum
  const hpAlpha = Math.exp((-2 * Math.PI * 130) / sampleRate);
  let hpIn = 0;
  let hpOut = 0;
  const filtered = new Float32Array(len);
  for (let j = 0; j < len; j++) {
    const x = raw[trim + j] - dc;
    hpOut = hpAlpha * (hpOut + x - hpIn);
    hpIn = x;
    filtered[j] = hpOut;
  }

  let sumSq = 0;
  let peak = 0;
  for (let j = 0; j < len; j++) {
    const a = Math.abs(filtered[j]);
    sumSq += filtered[j] * filtered[j];
    if (a > peak) peak = a;
  }
  const rms = Math.sqrt(sumSq / len);

  const targetRms = 5200;
  const targetPeak = 24000;
  let gain = 1;
  if (rms > 120) {
    gain = Math.min(targetRms / rms, targetPeak / Math.max(peak, 1));
  }
  gain = Math.min(gain, 2.0);

  const out = new Int16Array(len);
  for (let j = 0; j < len; j++) {
    let s = filtered[j] * gain;
    const x = s / 32768;
    s = x * (1.4 - 0.4 * x * x) * 32768;
    if (s > 32767) s = 32767;
    if (s < -32768) s = -32768;
    out[j] = s;
  }

  return new Uint8Array(out.buffer);
}

function encodeWavFromPcmBytes(pcmBytes, sampleRate = 16000, options = {}) {
  const processed = options.raw
    ? pcmBytes
    : processEsp32PcmBytes(pcmBytes, sampleRate);
  const numSamples = Math.floor(processed.length / 2);
  const dataSize = numSamples * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeStr = (offset, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);

  const out = new Uint8Array(buffer, 44);
  out.set(processed.subarray(0, dataSize));

  return new Blob([buffer], { type: "audio/wav" });
}

function mergePcmChunks(chunks) {
  let total = 0;
  for (const c of chunks) total += c.length;
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.length;
  }
  return merged;
}

function pcmLevelFromBytes(pcmBytes) {
  const n = Math.floor(pcmBytes.length / 2);
  if (n === 0) return 0;
  let sumSq = 0;
  const view = new DataView(pcmBytes.buffer, pcmBytes.byteOffset, pcmBytes.byteLength);
  for (let i = 0; i < n; i++) {
    const s = view.getInt16(i * 2, true) / 32768;
    sumSq += s * s;
  }
  return Math.min(1, Math.sqrt(sumSq / n) * 6);
}

function synthesizeWavFromMetrics(samples, sampleRate = 16000) {
  if (!samples || samples.length < 2) return null;

  const maxLevel = Math.max(...samples.map(s => s.level), 0.02);
  const maxPeak = Math.max(...samples.map(s => s.peak), 0.02);
  const norm = samples.map(s => ({
    t: s.t,
    level: s.level / maxLevel,
    peak: s.peak / maxPeak
  }));

  const tStart = norm[0].t;
  const tEnd = norm[norm.length - 1].t;
  const durationMs = Math.max(400, tEnd - tStart);
  const numSamples = Math.floor((durationMs / 1000) * sampleRate);
  const pcm = new Int16Array(numSamples);

  const interp = (timeMs, key) => {
    if (timeMs <= norm[0].t) return norm[0][key];
    if (timeMs >= norm[norm.length - 1].t) return norm[norm.length - 1][key];
    for (let i = 0; i < norm.length - 1; i++) {
      const a = norm[i];
      const b = norm[i + 1];
      if (timeMs >= a.t && timeMs <= b.t) {
        const u = (timeMs - a.t) / Math.max(1, b.t - a.t);
        return a[key] + (b[key] - a[key]) * u;
      }
    }
    return norm[norm.length - 1][key];
  };

  const GATE = 0.06;
  let phase1 = 0;
  let phase2 = 0;
  let phase3 = 0;

  for (let i = 0; i < numSamples; i++) {
    const t = tStart + (i / numSamples) * durationMs;
    const env = interp(t, "level");
    const peak = interp(t, "peak");

    if (env < GATE) {
      pcm[i] = 0;
      continue;
    }

    const fBase = 110 + peak * 420 + env * 90;
    phase1 += (2 * Math.PI * fBase) / sampleRate;
    phase2 += (2 * Math.PI * fBase * 2.03) / sampleRate;
    phase3 += (2 * Math.PI * fBase * 3.07) / sampleRate;

    const tone =
      Math.sin(phase1) * 0.58 +
      Math.sin(phase2) * 0.26 +
      Math.sin(phase3) * 0.11;
    const breath = Math.sin(phase1 * 0.11 + i * 0.002) * peak * 0.12;
    const v = (tone + breath) * env * 0.78;
    pcm[i] = Math.max(-32768, Math.min(32767, Math.round(v * 22000)));
  }

  return encodeWavFromPcmBytes(new Uint8Array(pcm.buffer), sampleRate, { raw: true });
}

window.encodeWavFromPcmBytes = encodeWavFromPcmBytes;
window.processEsp32PcmBytes = processEsp32PcmBytes;
window.mergePcmChunks = mergePcmChunks;
window.pcmLevelFromBytes = pcmLevelFromBytes;
window.synthesizeWavFromMetrics = synthesizeWavFromMetrics;
