// Converts audio features + personality into rich visual controls.
// Each sound gets a distinct palette, motion signature, and temporal arc.
class VisualMappingEngine {
  constructor() {
    this.parameters = {};
  }

  compute(personalityVector, features, aiResult) {
    const p = personalityVector || {};
    const f = features || {};
    const ai = aiResult || {};
    const structure = ai.structure || {};
    const sections = f.sections || {};

    const energy = this.clamp01(p.energy);
    const calm = this.clamp01(p.calmness);
    const playful = this.clamp01(p.playfulness);
    const curious = this.clamp01(p.curiosity);
    const warmth = this.clamp01(p.warmth);

    const brightness = this.clamp01(f.brightness);
    const bass = this.clamp01(f.bass);
    const treble = this.clamp01(f.treble);
    const rough = this.clamp01(f.roughness);
    const sv = this.clamp01(f.spectralVariation);

    const seed = this.soundSeed(f);

    const palette = this.buildPalette(warmth, playful, brightness, bass, treble, sv, seed, f);
    const temporal = this.buildTemporal(sections);

    return {
      motionSpeed: this.clamp01(energy * 0.7 + brightness * 0.3),
      particleDensity: this.clamp01(energy * 0.5 + structure.density * 0.35 + bass * 0.15),
      brushSoftness: this.clamp01(calm * 0.6 + structure.smoothness * 0.4),
      flowSmoothness: this.clamp01(calm * 0.55 + structure.stability * 0.45),
      shapeComplexity: this.clamp01(playful * 0.5 + curious * 0.3 + sv * 0.2),
      colorVariation: this.clamp01(playful * 0.4 + sv * 0.35 + curious * 0.25),
      growthBranching: this.clamp01(curious * 0.55 + structure.variation * 0.45),
      directionChange: this.clamp01(curious * 0.5 + rough * 0.3 + sv * 0.2),
      colorTemperature: warmth,
      flowDirection: (seed % 360) * (Math.PI / 180),
      texturePattern: this.pickTexture(seed, playful, rough),
      strokeBehavior: this.pickStroke(seed, energy, calm),
      palette,
      temporal,
      soundSeed: seed
    };
  }

  buildPalette(warmth, playful, brightness, bass, treble, variation, seed, features) {
    if (typeof SoundColorEngine !== "undefined" && features && (features.volume != null || features.bass != null)) {
      return SoundColorEngine.buildFromFeatures(features, null);
    }
    const hueBase = this.clamp01(warmth) * 55 + (1 - this.clamp01(warmth)) * 210;
    const hueSpread = 18 + variation * 72 + playful * 28;
    const satBase = 28 + playful * 42 + brightness * 22;
    const lightBase = 38 + brightness * 28 + treble * 12;
    const count = 5;
    const palette = [];

    for (let i = 0; i < count; i++) {
      const t = count > 1 ? i / (count - 1) : 0.5;
      const hue = (hueBase + (t - 0.5) * hueSpread + (seed % 37)) % 360;
      const sat = this.clamp01((satBase + bass * 18 * (1 - t) + treble * 14 * t) / 100) * 100;
      const light = this.clampByte(lightBase + (t - 0.5) * 22 - bass * 8);
      const rgb = this.hslToRgb(hue, sat, light);
      palette.push(rgb);
    }
    return palette;
  }

  buildTemporal(sections) {
    const b = sections.beginning || {};
    const m = sections.middle || {};
    const e = sections.end || {};

    const phase = (feat) => ({
      energy: this.clamp01((feat.energy || 0) * 0.5 + (feat.volume || 0) * 0.5),
      density: this.clamp01((feat.energy || 0) * 0.4 + (feat.bass || 0) * 0.35 + (feat.roughness || 0) * 0.25),
      brightness: this.clamp01(feat.brightness || 0),
      dispersion: this.clamp01((feat.roughness || 0) * 0.45 + (feat.spectralVariation || 0) * 0.55),
      flow: this.clamp01(1 - (feat.roughness || 0) * 0.5)
    });

    return {
      beginning: phase(b),
      middle: phase(m),
      end: phase(e)
    };
  }

  // Slow cyclic blend: beginning → middle → end → beginning
  sampleTemporal(temporal, cycleT) {
    const t = this.clamp01(cycleT);
    if (t < 0.33) {
      const u = t / 0.33;
      return this.lerpPhase(temporal.beginning, temporal.middle, u);
    }
    if (t < 0.66) {
      const u = (t - 0.33) / 0.33;
      return this.lerpPhase(temporal.middle, temporal.end, u);
    }
    const u = (t - 0.66) / 0.34;
    return this.lerpPhase(temporal.end, temporal.beginning, u);
  }

  lerpPhase(a, b, t) {
    return {
      energy: lerp(a.energy, b.energy, t),
      density: lerp(a.density, b.density, t),
      brightness: lerp(a.brightness, b.brightness, t),
      dispersion: lerp(a.dispersion, b.dispersion, t),
      flow: lerp(a.flow, b.flow, t)
    };
  }

  pickTexture(seed, playful, rough) {
    const modes = ["mist", "grain", "flow", "scatter", "ripple"];
    const idx = Math.floor((seed * 0.17 + playful * 2.3 + rough * 1.7) % modes.length);
    return modes[idx];
  }

  pickStroke(seed, energy, calm) {
    if (energy > 0.65) return "burst";
    if (calm > 0.7) return "soft";
    if ((seed % 3) === 0) return "ribbon";
    return (seed % 2) === 0 ? "dust" : "pulse";
  }

  soundSeed(features) {
    const keys = ["volume", "pitch", "tempo", "bass", "treble", "brightness", "energy", "roughness"];
    let h = 0;
    keys.forEach((k, i) => {
      h += Math.floor((features[k] || 0) * 997 + i * 131);
    });
    return Math.abs(h);
  }

  hslToRgb(h, s, l) {
    h = ((h % 360) + 360) % 360;
    s /= 100;
    l /= 100;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs((h / 60) % 2 - 1));
    const m = l - c / 2;
    let r = 0, g = 0, b = 0;
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
  }

  update(personalityVector, features, aiResult) {
    const next = this.compute(personalityVector, features, aiResult);
    if (!this.parameters.palette) {
      this.parameters = next;
      return this.parameters;
    }
    Object.keys(next).forEach((key) => {
      if (key === "palette" || key === "temporal" || key === "texturePattern" || key === "strokeBehavior") {
        this.parameters[key] = next[key];
      } else if (typeof next[key] === "number") {
        this.parameters[key] = lerp(this.parameters[key] || 0, next[key], 0.1);
      }
    });
    return this.parameters;
  }

  clamp01(v) { return Math.min(1, Math.max(0, v || 0)); }
  clampByte(v) { return Math.min(255, Math.max(0, Math.round(v))); }
}

window.VisualMappingEngine = VisualMappingEngine;
