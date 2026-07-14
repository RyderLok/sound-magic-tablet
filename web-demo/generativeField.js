// Sound Breathing — stippled audio-reactive particle sphere.
// Renders only inside the supplied "sound breathing" region (offscreen layer).
// Integration point unchanged: update(region, visualParameters, personality, aiResult).
class GenerativeField {
  constructor(options = {}) {
    this.seed = options.seed || 0;
    this.mirror = !!options.mirror;
    this.layer = null;
    this.region = { x: 0, y: 0, w: 0, h: 0 };
    this.particles = [];
    this.maxParticles = 34000;
    this.t = this.seed * 101.31;
    this.audio = this.setupAudio();
    this.audioFeatures = { volume: 0, low: 0, mid: 0, high: 0, centroid: 0 };
    this.smoothed = {
      volume: 0.04,
      low: 0.08,
      mid: 0.08,
      high: 0.06,
      centroid: 0.1,
      baseRadius: 0
    };
    this.POINT_ALPHA = 18;
    this.TRAIL_FADE = 14;
    this.smoothedInk = { r: 140, g: 120, b: 180 };
    this.esp32FlashBoost = 0;
    this.esp32Drift = { x: 0, y: 0, meanSigned: 0 };
  }

  setupAudio() {
    return { esp32Only: true };
  }

  ensureLayer(region) {
    const w = Math.max(1, Math.floor(region.w));
    const h = Math.max(1, Math.floor(region.h));
    if (!this.layer || this.layer.width !== w || this.layer.height !== h) {
      this.layer = createGraphics(w, h);
      this.layer.elt.style.display = "none";
      this.layer.pixelDensity(1);
      this.clearLayer();
      this.createParticles();
    }
    this.region = { x: region.x, y: region.y, w, h };
  }

  clearLayer() {
    if (this.layer) this.layer.clear();
  }

  createParticles() {
    if (!this.layer) return;
    const minSide = Math.min(this.layer.width, this.layer.height);
    const count = Math.floor(this.constrain(minSide * 78, 12000, this.maxParticles));
    this.particles = [];
    for (let i = 0; i < count; i++) {
      this.particles.push(this.spawnParticle(true));
    }
  }

  clear() {
    this.clearLayer();
    this.createParticles();
  }

  update(region, visualParameters, personality, aiResult) {
    this.ensureLayer(region);
    this.updateAudioFeatures(visualParameters, personality, aiResult);
    const field = this.computeFieldState();
    this.updateParticles(field);
    this.drawParticles(field, visualParameters);
    image(this.layer, this.region.x, this.region.y);
  }

  updateAudioFeatures(visualParameters, personality, aiResult) {
    const analysed = window.activeAudioFeatures || {};
    const py = window.pythonEnhancedFeatures;
    const merged = py ? FeatureSchema.mergeFeatures(analysed, py, 0.4) : analysed;
    const vp = visualParameters || {};
    const p = personality || {};
    let volume = 0, low = 0, mid = 0, high = 0, centroid = 0;

    const esp32 = window.esp32AudioAdapter;
    if (esp32 && esp32.isConnected()) {
      const live = esp32.getVisualFeatures();
      volume = Math.max(volume, live.volume);
      low = Math.max(low, live.low);
      mid = Math.max(mid, live.mid);
      high = Math.max(high, live.high);
      centroid = Math.max(centroid, live.centroid);
      this.esp32FlashBoost = live.flashBoost;
      this.esp32Drift = { x: live.driftX, y: live.driftY, meanSigned: live.meanSigned };
    } else {
      this.esp32FlashBoost = 0;
      this.esp32Drift = { x: 0, y: 0, meanSigned: 0 };
    }

    const profile = merged.spectrumProfile || [];
    const fallbackVolume = merged.volume ?? vp.motionSpeed ?? p.energy ?? 0.05;
    const fallbackLow = merged.bass ?? this.profileBand(profile, 0, 0.18) ?? vp.particleDensity ?? 0.08;
    const fallbackMid = merged.mid ?? this.profileBand(profile, 0.18, 0.58) ?? vp.shapeComplexity ?? 0.08;
    const fallbackHigh = merged.treble ?? this.profileBand(profile, 0.58, 1) ?? vp.colorVariation ?? 0.06;
    const fallbackCentroid = merged.pitch ?? vp.directionChange ?? 0.08;

    this.audioFeatures.volume = this.clamp01(volume * 3.2 + fallbackVolume * 0.7);
    this.audioFeatures.low = this.clamp01(low + fallbackLow * 0.8);
    this.audioFeatures.mid = this.clamp01(mid + fallbackMid * 0.72);
    this.audioFeatures.high = this.clamp01(high + fallbackHigh * 0.72);
    this.audioFeatures.centroid = this.clamp01(centroid + fallbackCentroid * 0.5);

    this.smoothed.volume = lerp(this.smoothed.volume, this.audioFeatures.volume, 0.07);
    this.smoothed.low = lerp(this.smoothed.low, this.audioFeatures.low, 0.06);
    this.smoothed.mid = lerp(this.smoothed.mid, this.audioFeatures.mid, 0.07);
    this.smoothed.high = lerp(this.smoothed.high, this.audioFeatures.high, 0.08);
    this.smoothed.centroid = lerp(this.smoothed.centroid, this.audioFeatures.centroid, 0.06);
  }

  computeFieldState() {
    const g = this.layer;
    const w = g.width;
    const h = g.height;
    const minSide = Math.min(w, h);
    const cx = w * 0.5 + (this.esp32Drift?.x || 0);
    const cy = h * 0.52 + (this.esp32Drift?.y || 0);

    const vol = this.smoothed.volume;
    const low = this.smoothed.low;
    const high = this.smoothed.high;
    const centroid = this.smoothed.centroid;
    const densityBoost = window.esp32AudioAdapter?.isConnected()
      ? lerp(1, 1.22, vol)
      : 1;

    const targetRadius = minSide * lerp(0.07, 0.34, vol) * densityBoost;
    this.smoothed.baseRadius = lerp(this.smoothed.baseRadius, targetRadius, 0.06);
    const baseRadius = this.smoothed.baseRadius;

    const centripetal = lerp(0.028, 0.004, vol);
    const centrifugal = vol * 0.38;

    const noiseScale = lerp(0.0045, 0.038, high * 0.85 + centroid * 0.15);
    const noiseForce = lerp(0.035, 0.42, low);
    const meanDrift = (this.esp32Drift?.meanSigned || 0) * 0.003;
    const noiseTimeSpeed = 0.004 + centroid * 0.014 + high * 0.008 + meanDrift;
    this.t += noiseTimeSpeed;

    const respawnSigma = minSide * lerp(0.035, 0.11, vol);
    const maxDist = minSide * 0.58;

    return {
      w, h, minSide, cx, cy,
      vol, low, high, centroid,
      baseRadius, centripetal, centrifugal,
      noiseScale, noiseForce, respawnSigma, maxDist,
      flashBoost: this.esp32FlashBoost || 0
    };
  }

  sampleNoiseFlow(p, field) {
    const mirror = this.mirror ? -1 : 1;
    const nx = p.x * field.noiseScale + this.seed * 11.3;
    const ny = p.y * field.noiseScale - this.seed * 5.7;
    const nz = this.t + p.noiseOffset * 0.0015;

    const n1 = noise(nx, ny, nz);
    const n2 = noise(nx * 2.1 + 19, ny * 2.1 - 11, nz * 0.85);
    const angle = (n1 * 0.72 + n2 * 0.28) * TWO_PI * 2;

    const force = field.noiseForce * p.flowWeight;
    let fx = Math.cos(angle) * force;
    let fy = Math.sin(angle) * force;

    const dx = p.x - field.cx;
    const dy = p.y - field.cy;
    const dist = Math.sqrt(dx * dx + dy * dy) + 0.001;
    const vortex = field.low * 0.0011 * field.minSide * mirror;
    fx += (-dy / dist) * vortex * p.vortexWeight;
    fy += (dx / dist) * vortex * p.vortexWeight;

    return { fx, fy };
  }

  updateParticles(field) {
    const { cx, cy, baseRadius, centripetal, centrifugal, maxDist, w, h } = field;

    for (const p of this.particles) {
      const dx = p.x - cx;
      const dy = p.y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy) + 0.001;
      const nx = dx / dist;
      const ny = dy / dist;

      const homeDist = baseRadius * p.orbit;
      const homeX = cx + Math.cos(p.homeAngle) * homeDist;
      const homeY = cy + Math.sin(p.homeAngle) * homeDist;

      p.vx += (homeX - p.x) * centripetal * p.springWeight;
      p.vy += (homeY - p.y) * centripetal * p.springWeight;

      p.vx += nx * centrifugal * p.radialWeight;
      p.vy += ny * centrifugal * p.radialWeight;

      const flow = this.sampleNoiseFlow(p, field);
      p.vx += flow.fx;
      p.vy += flow.fy;

      p.vx *= p.damping;
      p.vy *= p.damping;
      p.x += p.vx;
      p.y += p.vy;

      p.life -= 0.00065 + field.high * 0.00045;

      const outOfBounds =
        dist > maxDist * 1.25 ||
        p.life <= 0 ||
        p.x < -2 || p.x > w + 2 ||
        p.y < -2 || p.y > h + 2;

      if (outOfBounds) {
        Object.assign(p, this.spawnParticle(false, field));
      }
    }
  }

  resolveInkColor(visualParameters) {
    const palette = (visualParameters && visualParameters.palette) || [];
    let target = { r: 42, g: 98, b: 62 };
    if (palette.length) {
      const idx = Math.min(1, palette.length - 1);
      const c = palette[idx];
      target = { r: c.r, g: c.g, b: c.b };
    }
    this.smoothedInk.r = lerp(this.smoothedInk.r, target.r, 0.1);
    this.smoothedInk.g = lerp(this.smoothedInk.g, target.g, 0.1);
    this.smoothedInk.b = lerp(this.smoothedInk.b, target.b, 0.1);
    return this.smoothedInk;
  }

  drawParticles(field, visualParameters) {
    const g = this.layer;
    const ctx = g.drawingContext;
    const ink = this.resolveInkColor(visualParameters);

    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    g.noStroke();
    g.fill(0, 0, 0, this.TRAIL_FADE);
    g.rect(0, 0, g.width, g.height);
    ctx.restore();

    g.strokeWeight(1);
    g.stroke(ink.r, ink.g, ink.b, this.POINT_ALPHA + (field.flashBoost || 0));
    for (const p of this.particles) {
      g.point(p.x, p.y);
    }
  }

  spawnParticle(initial, field) {
    const g = this.layer;
    const w = g ? g.width : 100;
    const h = g ? g.height : 100;
    const minSide = Math.min(w, h);
    const cx = w * 0.5;
    const cy = h * 0.52;

    const sigma = field
      ? field.respawnSigma
      : minSide * 0.06;

    const r = Math.abs(randomGaussian(0, sigma));
    const angle = Math.random() * TWO_PI;
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r;

    const orbit = this.constrain(Math.abs(randomGaussian(0, 0.38)) + Math.random() * 0.12, 0.02, 1);

    return {
      x,
      y,
      vx: randomGaussian(0, 0.04),
      vy: randomGaussian(0, 0.04),
      homeAngle: Math.random() * TWO_PI,
      orbit,
      noiseOffset: Math.random() * 1000 + this.seed * 37,
      life: lerp(0.75, 1, Math.random()),
      flowWeight: lerp(0.4, 1.1, Math.random()),
      vortexWeight: lerp(0.3, 1.0, Math.random()),
      springWeight: lerp(0.6, 1.2, Math.random()),
      radialWeight: lerp(0.5, 1.3, Math.random()),
      damping: lerp(0.968, 0.988, Math.random())
    };
  }

  bandAverage(spectrum, from, to) {
    const start = Math.floor(spectrum.length * from);
    const end = Math.max(start + 1, Math.floor(spectrum.length * to));
    let sum = 0;
    for (let i = start; i < end; i++) sum += spectrum[i] / 255;
    return this.clamp01(sum / (end - start));
  }

  profileBand(profile, from, to) {
    if (!profile || !profile.length) return 0;
    const start = Math.floor(profile.length * from);
    const end = Math.max(start + 1, Math.floor(profile.length * to));
    let sum = 0;
    for (let i = start; i < end; i++) sum += profile[i] || 0;
    return this.clamp01(sum / (end - start));
  }

  constrain(v, min, max) { return Math.min(max, Math.max(min, v)); }
  clamp01(v) { return Math.min(1, Math.max(0, v || 0)); }
}

window.GenerativeField = GenerativeField;
