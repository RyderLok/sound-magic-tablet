// Per-recording acoustic signature → vivid, distinct color palettes.
const SoundColorEngine = {
  archetypeHue: {
    birds: 28,
    wind_leaves: 272,
    water: 204,
    material_impact: 16,
    insects_amphibians: 52
  },

  clamp01(v) {
    return Math.min(1, Math.max(0, v || 0));
  },

  clampByte(v) {
    return Math.min(255, Math.max(0, Math.round(v)));
  },

  featureSeed(features) {
    const f = features || {};
    const keys = [
      "volume", "pitch", "tempo", "bass", "mid", "treble",
      "brightness", "energy", "roughness", "dynamicRange", "zcr"
    ];
    let h = 0;
    keys.forEach((k, i) => {
      h += Math.floor((f[k] || 0) * 991 + i * 127);
    });
    const profile = f.spectrumProfile || [];
    for (let i = 0; i < Math.min(profile.length, 32); i += 4) {
      h += Math.floor((profile[i] || 0) * 503 + i * 17);
    }
    return Math.abs(h);
  },

  profileBand(profile, from, to) {
    if (!profile?.length) return 0;
    const start = Math.floor(profile.length * from);
    const end = Math.max(start + 1, Math.floor(profile.length * to));
    let sum = 0;
    for (let i = start; i < end; i += 1) sum += profile[i] || 0;
    return this.clamp01(sum / (end - start));
  },

  hslToRgb(h, s, l) {
    h = ((h % 360) + 360) % 360;
    s /= 100;
    l /= 100;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs((h / 60) % 2 - 1));
    const m = l - c / 2;
    let r = 0; let g = 0; let b = 0;
    if (h < 60) { r = c; g = x; }
    else if (h < 120) { r = x; g = c; }
    else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; }
    else if (h < 300) { r = x; b = c; }
    else { r = c; b = x; }
    return {
      r: this.clampByte((r + m) * 255),
      g: this.clampByte((g + m) * 255),
      b: this.clampByte((b + m) * 255)
    };
  },

  buildFromFeatures(features, archetypeId) {
    const f = features || {};
    const seed = this.featureSeed(f);
    const bass = this.clamp01(f.bass);
    const mid = this.clamp01(f.mid);
    const treble = this.clamp01(f.treble);
    const pitch = this.clamp01(f.pitch);
    const bright = this.clamp01(f.brightness);
    const rough = this.clamp01(f.roughness);
    const energy = this.clamp01(f.energy ?? f.volume);
    const profile = f.spectrumProfile || [];

    let hueCenter;
    if (archetypeId && this.archetypeHue[archetypeId] != null) {
      hueCenter = this.archetypeHue[archetypeId];
    } else {
      hueCenter = (seed * 0.6180339887) % 360;
    }

    const pitchShift = (pitch - 0.5) * 56;
    const brightShift = (bright - 0.5) * 28;
    const hueSpread = 36 + rough * 48 + energy * 32 + (seed % 24);
    const count = 7;
    const palette = [];

    for (let i = 0; i < count; i += 1) {
      const t = count > 1 ? i / (count - 1) : 0.5;
      const specLow = this.profileBand(profile, 0, 0.33);
      const specMid = this.profileBand(profile, 0.33, 0.66);
      const specHigh = this.profileBand(profile, 0.66, 1);
      const specNudge = (specLow * (1 - t) + specMid * 0.5 + specHigh * t) * 72 - 36;

      let hue = hueCenter + pitchShift + brightShift + specNudge;
      hue += (t - 0.5) * hueSpread;
      hue += (seed % 41) * t * 0.35;
      if (archetypeId === "insects_amphibians" && i === count - 1) hue += 210;
      if (archetypeId === "birds" && i === 0) hue -= 8;

      const sat = 52 + energy * 28 + mid * 22 + treble * 18 + (seed % 13);
      const light = 34 + bright * 26 + treble * 22 * t + bass * 20 * (1 - t) + (i % 2) * 6;

      palette.push(this.hslToRgb(hue, Math.min(92, sat), Math.min(72, light)));
    }
    return palette;
  },

  liveModulate(color, features, amount) {
    const a = Math.min(1, Math.max(0, amount ?? 0.15));
    const bass = this.clamp01(features?.bass);
    const mid = this.clamp01(features?.mid);
    const treble = this.clamp01(features?.treble);
    const vol = this.clamp01(features?.volume ?? features?.energy);
    return {
      r: this.clampByte(color.r + bass * 28 * a + vol * 12 * a),
      g: this.clampByte(color.g + mid * 32 * a + vol * 8 * a),
      b: this.clampByte(color.b + treble * 38 * a + vol * 10 * a)
    };
  },

  modulatePalette(palette, features, amount) {
    if (!palette?.length) return palette;
    return palette.map((c, i) => {
      const band = i / Math.max(1, palette.length - 1);
      const f = {
        bass: (features?.bass ?? 0) * (1 - band * 0.5),
        mid: features?.mid ?? 0,
        treble: (features?.treble ?? 0) * (0.5 + band * 0.5),
        volume: features?.volume ?? features?.energy ?? 0
      };
      return this.liveModulate(c, f, amount);
    });
  }
};

window.SoundColorEngine = SoundColorEngine;
