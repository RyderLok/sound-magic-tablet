// Rule-based perceptual mapping AI.
// Receives normalised audio features only; never reads microphone input.
class SoundPersonalityAI {
  constructor() {
    this.personality = {
      energy: 0,
      calmness: 1,
      playfulness: 0,
      curiosity: 0,
      warmth: 0
    };
  }

  update(audioFeatures) {
    const energy = (audioFeatures.volume * 0.5) + (audioFeatures.energy * 0.5);
    const nextPersonality = {
      energy,
      calmness: 1.0 - energy,
      playfulness: (audioFeatures.treble * 0.4) + (audioFeatures.brightness * 0.3) + (audioFeatures.roughness * 0.3),
      curiosity: (audioFeatures.brightness * 0.5) + (audioFeatures.treble * 0.3) + (audioFeatures.roughness * 0.2),
      warmth: (audioFeatures.bass * 0.4) + (audioFeatures.mid * 0.4) - (audioFeatures.treble * 0.2)
    };

    Object.keys(nextPersonality).forEach((key) => {
      nextPersonality[key] = this.clamp01(nextPersonality[key]);
      this.personality[key] = lerp(this.personality[key], nextPersonality[key], 0.12);
    });

    return this.personality;
  }

  compute(audioFeatures) {
    const energy = this.clamp01((audioFeatures.volume * 0.5) + (audioFeatures.energy * 0.5));
    return {
      energy,
      calmness: this.clamp01(1.0 - energy),
      playfulness: this.clamp01(
        (audioFeatures.treble * 0.4) + (audioFeatures.brightness * 0.3) + (audioFeatures.roughness * 0.3)
      ),
      curiosity: this.clamp01(
        (audioFeatures.brightness * 0.5) + (audioFeatures.treble * 0.3) + (audioFeatures.roughness * 0.2)
      ),
      warmth: this.clamp01(
        (audioFeatures.bass * 0.4) + (audioFeatures.mid * 0.4) - (audioFeatures.treble * 0.2)
      )
    };
  }

  computeAll(audioFeatures) {
    const personality = this.compute(audioFeatures);
    const emotion = this.mapEmotion(personality);
    const structure = this.mapStructure(audioFeatures, personality);
    return { personality, emotion, structure };
  }

  // Human-readable sound identity for the interpretation panel.
  generateIdentity(features, aiResult, visualParams) {
    const p = aiResult.personality;
    const st = aiResult.structure;
    const em = aiResult.emotion;
    const sections = features.sections || {};
    const vp = visualParams || {};

    const topEmotion = Object.entries(em).sort((a, b) => b[1] - a[1])[0][0];
    const name = this.buildIdentityName(p, st, topEmotion, features);
    const interpretation = this.buildInterpretation(p, em, topEmotion);
    const personalitySummary = this.describePersonality(p, em, topEmotion);
    const structureSummary = this.describeStructure(st, features);
    const temporalSummary = this.describeTemporal(sections);
    const materialSummary = this.describeMaterial(vp, p, st);

    return {
      name,
      interpretation,
      personalitySummary,
      structureSummary,
      temporalSummary,
      materialSummary
    };
  }

  buildIdentityName(p, st, topEmotion, f) {
    const mood = {
      peaceful: "Gentle", excited: "Sparkling", gentle: "Soft", mysterious: "Whispering"
    }[topEmotion] || "Quiet";

    const texture = st.repetition > 0.6 ? "Repetitive" : st.variation > 0.55 ? "Wandering" : "Flowing";
    const tone = p.warmth > 0.55 ? "Warm" : p.warmth < 0.4 ? "Cool" : "Balanced";
    const source = f.roughness > 0.5 ? "Grain" : f.brightness > 0.55 ? "Bright" : "Hushed";

    const combos = [
      `${mood} ${texture} ${source}`,
      `${tone} ${mood} ${source} Drift`,
      `${mood} ${st.density > 0.55 ? "Dense" : "Light"} ${source} Cloud`,
      `${texture} ${tone} ${source} Whisper`
    ];
    const idx = Math.floor((f.pitch || 0.5) * combos.length) % combos.length;
    return combos[idx];
  }

  buildInterpretation(p, em, topEmotion) {
    const lines = {
      peaceful: "This sound feels like a quiet room where light dust floats slowly in the air.",
      excited: "This sound bursts with tiny sparks — lively, bright, and ready to dance.",
      gentle: "This sound wraps around you softly, like a warm blanket of quiet tones.",
      mysterious: "This sound hides little secrets — it drifts and shifts, inviting you to explore."
    };
    const base = lines[topEmotion] || lines.gentle;
    if (p.playfulness > 0.55) return base + " It has a playful, curious sparkle.";
    if (p.calmness > 0.7) return base + " Everything moves slowly and peacefully.";
    return base;
  }

  describePersonality(p, em, topEmotion) {
    const traits = [];
    if (p.calmness > 0.55) traits.push("calm");
    else if (p.energy > 0.45) traits.push("energetic");
    if (p.warmth > 0.55) traits.push("warm");
    else if (p.warmth < 0.4) traits.push("cool");
    if (stability(p) > 0.55) traits.push("stable");
    if (p.playfulness > 0.45) traits.push("playful");
    if (p.curiosity > 0.45) traits.push("curious");
    if (!traits.length) traits.push("gentle", "quiet");

    function stability(pv) { return 1 - pv.energy * 0.4; }
    return traits.slice(0, 4).join(", ");
  }

  describeStructure(st, f) {
    const parts = [];
    if (st.repetition > 0.55) parts.push("repetitive");
    else parts.push("changing");
    if (st.smoothness > 0.55) parts.push("smooth");
    else parts.push("textured");
    if (st.variation < 0.35) parts.push("low variation");
    else if (st.variation > 0.6) parts.push("high variation");
    else parts.push("gentle variation");
    if (st.density > 0.55) parts.push("dense");
    return parts.join(", ");
  }

  describeTemporal(sections) {
    const b = sections.beginning || {};
    const m = sections.middle || {};
    const e = sections.end || {};

    const bE = (b.energy || 0) + (b.volume || 0);
    const mE = (m.energy || 0) + (m.volume || 0);
    const eE = (e.energy || 0) + (e.volume || 0);

    if (mE > bE + 0.15 && mE > eE + 0.1) {
      return "It starts quietly, grows fuller in the middle, then settles again.";
    }
    if (eE < bE - 0.1 && eE < mE - 0.1) {
      return "It begins bright, holds steady, then fades into a soft whisper.";
    }
    if (bE > mE && bE > eE) {
      return "It opens with energy, then gradually calms and disperses.";
    }
    if (Math.abs(mE - bE) < 0.12 && Math.abs(eE - mE) < 0.12) {
      return "It stays steady throughout — a continuous, even breath of sound.";
    }
    return "The middle becomes denser, then returns to calm.";
  }

  describeMaterial(vp, p, st) {
    const palette = vp.palette || [];
    const colorWord = this.paletteWord(palette, p.warmth);
    const motion = vp.motionSpeed > 0.55 ? "quick swirling" : vp.motionSpeed > 0.3 ? "gentle circular" : "slow drifting";
    const brush = vp.brushSoftness > 0.6 ? "soft" : "dusty";
    const texture = vp.texturePattern || "flow";
    const stroke = vp.strokeBehavior || "dust";
    return `${brush} ${colorWord} particle brush with ${motion} flow · ${texture} texture · ${stroke} strokes`;
  }

  paletteWord(palette, warmth) {
    if (!palette.length) return warmth > 0.5 ? "warm-toned" : "cool-toned";
    const avg = palette.reduce((acc, c) => ({
      r: acc.r + c.r, g: acc.g + c.g, b: acc.b + c.b
    }), { r: 0, g: 0, b: 0 });
    const n = palette.length;
    const r = avg.r / n, g = avg.g / n, b = avg.b / n;
    if (r > g + 20 && r > b) return "sunset coral";
    if (b > r + 15 && b > g) return "twilight blue-purple";
    if (g > r && g > b) return "meadow green";
    if (r > 180 && g > 140) return "golden honey";
    if (r < 100 && b < 100) return "soft grey-purple";
    return warmth > 0.5 ? "warm amber" : "cool lavender";
  }

  mapEmotion(personality) {
    const { energy, calmness, playfulness, curiosity, warmth } = personality;
    return {
      peaceful: this.clamp01(calmness * 0.5 + warmth * 0.3 + (1 - energy) * 0.2),
      excited: this.clamp01(energy * 0.5 + playfulness * 0.3 + curiosity * 0.2),
      gentle: this.clamp01(calmness * 0.4 + warmth * 0.4 + (1 - playfulness) * 0.2),
      mysterious: this.clamp01(curiosity * 0.5 + (1 - warmth) * 0.3 + playfulness * 0.2)
    };
  }

  mapStructure(audioFeatures, personality) {
    const sv = audioFeatures.spectralVariation || 0;
    const rough = audioFeatures.roughness || 0;
    return {
      stability: this.clamp01(1 - rough * 0.6 - sv * 0.4),
      repetition: this.clamp01(1 - sv * 0.7 - rough * 0.3),
      density: this.clamp01(
        (audioFeatures.energy * 0.5) + (rough * 0.3) + (audioFeatures.bass * 0.2)
      ),
      smoothness: this.clamp01(1 - rough * 0.6 - personality.playfulness * 0.4),
      variation: this.clamp01(sv * 0.5 + rough * 0.3 + personality.curiosity * 0.2)
    };
  }

  clamp01(value) {
    return Math.min(1, Math.max(0, value || 0));
  }
}

window.SoundPersonalityAI = SoundPersonalityAI;
