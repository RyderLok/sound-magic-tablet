// Breathing stipple brush — five natural-sound stroke patterns (design §3).
// scatter_points · flow_field · wave_ripple · impact_burst · pulse_grid
class BrushGenerator {
  constructor() {
    this.clusters = [];
    this.eraseWaves = [];
    this.maxClusters = 72;
    this.particlesPerCluster = 320;
    this.POINT_ALPHA = 26;
    this.TRAIL_FADE = 14;
    this.LIVE_TRAIL_FADE = 3;
    this.persistStrokes = true;
    this.tool = "draw";
    this.smoothedInk = { r: 120, g: 115, b: 110 };
    this.esp32FlashBoost = 0;
    this.esp32Drift = 0;
    this.pulsePhase = 0;
    this.wavePhase = 0;
    this.scatterHop = 0;
    this.smoothed = {
      volume: 0.04,
      low: 0.08,
      mid: 0.08,
      high: 0.06,
      centroid: 0.1
    };
  }

  clear() {
    this.clusters = [];
    this.eraseWaves = [];
    this.pulsePhase = 0;
    this.wavePhase = 0;
    this.scatterHop = 0;
  }

  setTool(tool) {
    this.tool = tool === "erase" ? "erase" : "draw";
  }

  resolvePattern(vp) {
    return vp?.strokePattern
      || window.activeVisualStructure?.strokePattern
      || window.activeFusedVisualParams?.strokePattern
      || "flow_field";
  }

  resolvePalette(visualParameters) {
    const vp = visualParameters || {};
    return vp.palette
      || window.activeFusedVisualParams?.palette
      || window.activeVisualParams?.palette
      || [];
  }

  addStroke(x, y, previousX, previousY, visualParameters) {
    const vp = visualParameters || window.activeFusedVisualParams || {};
    const pattern = this.resolvePattern(vp);
    switch (pattern) {
      case "scatter_points":
        this.addStrokeScatter(x, y, previousX, previousY, vp);
        break;
      case "wave_ripple":
        this.addStrokeWave(x, y, previousX, previousY, vp);
        break;
      case "impact_burst":
        this.addStrokeImpact(x, y, previousX, previousY, vp);
        break;
      case "pulse_grid":
        this.addStrokePulse(x, y, previousX, previousY, vp);
        break;
      default:
        this.addStrokeFlow(x, y, previousX, previousY, vp);
    }
  }

  addStrokeFlow(x, y, previousX, previousY, vp) {
    const brush = window.activeBrushParams;
    const energy = this.clamp01(brush?.motion ?? vp.motionSpeed ?? 0.05);
    const dist = Math.hypot(x - previousX, y - previousY);
    const steps = Math.max(1, Math.floor(dist / (12 - energy * 4)));
    for (let i = 0; i <= steps; i += 1) {
      const t = steps > 0 ? i / steps : 0;
      this.spawnCluster(
        lerp(previousX, x, t),
        lerp(previousY, y, t),
        vp,
        "flow_field"
      );
    }
  }

  addStrokeScatter(x, y, previousX, previousY, vp) {
    const brush = window.activeBrushParams || {};
    const continuity = this.clamp01(brush.continuity ?? 0.2);
    const hop = lerp(28, 14, continuity);
    const dist = Math.hypot(x - previousX, y - previousY);
    this.scatterHop += dist;
    if (this.scatterHop < hop && dist > 2) return;
    this.scatterHop = 0;

    const jitter = lerp(6, 18, 1 - continuity);
    this.spawnCluster(
      x + randomGaussian(0, jitter),
      y + randomGaussian(0, jitter),
      vp,
      "scatter_points"
    );
  }

  addStrokeWave(x, y, previousX, previousY, vp) {
    const brush = window.activeBrushParams || {};
    const energy = this.clamp01(brush.motion ?? vp.motionSpeed ?? 0.05);
    const dist = Math.hypot(x - previousX, y - previousY);
    const angle = Math.atan2(y - previousY, x - previousX);
    const perpX = -Math.sin(angle);
    const perpY = Math.cos(angle);
    const amp = lerp(8, 22, energy);
    const steps = Math.max(1, Math.floor(dist / 8));
    this.wavePhase += dist * 0.04;

    for (let i = 0; i <= steps; i += 1) {
      const t = steps > 0 ? i / steps : 0;
      const bx = lerp(previousX, x, t);
      const by = lerp(previousY, y, t);
      const wave = Math.sin(this.wavePhase + t * Math.PI * 2) * amp;
      this.spawnCluster(bx + perpX * wave, by + perpY * wave, vp, "wave_ripple", {
        waveAngle: angle,
        waveAmp: amp
      });
    }
  }

  addStrokeImpact(x, y, previousX, previousY, vp) {
    const dist = Math.hypot(x - previousX, y - previousY);
    const brush = window.activeBrushParams || {};
    const threshold = lerp(18, 8, brush.motion ?? 0.5);
    if (dist < 2) {
      this.spawnCluster(x, y, vp, "impact_burst", { burst: true });
      return;
    }
    if (dist >= threshold) {
      this.spawnCluster(x, y, vp, "impact_burst", { burst: true });
      this.spawnCluster(
        lerp(previousX, x, 0.5),
        lerp(previousY, y, 0.5),
        vp,
        "impact_burst",
        { burst: true, half: true }
      );
    }
  }

  addStrokePulse(x, y, previousX, previousY, vp) {
    const brush = window.activeBrushParams || {};
    const tempo = this.clamp01(brush.rotationSpeed ?? brush.motion ?? 0.5);
    const dist = Math.hypot(x - previousX, y - previousY);
    const angle = Math.atan2(y - previousY, x - previousX);
    const perpX = -Math.sin(angle);
    const perpY = Math.cos(angle);
    const spacing = lerp(14, 6, tempo);
    const steps = Math.max(1, Math.floor(dist / spacing));
    this.pulsePhase += steps * 0.35;

    for (let i = 0; i <= steps; i += 1) {
      const t = steps > 0 ? i / steps : 0;
      const bx = lerp(previousX, x, t);
      const by = lerp(previousY, y, t);
      const gridOff = (i % 2 === 0 ? 1 : -1) * lerp(4, 12, tempo);
      this.spawnCluster(
        bx + perpX * gridOff,
        by + perpY * gridOff,
        vp,
        "pulse_grid",
        { pulseIndex: i, pulsePhase: this.pulsePhase }
      );
    }
  }

  spawnCluster(cx, cy, visualParameters, pattern, meta) {
    const vp = visualParameters || {};
    const brush = window.activeBrushParams || {};
    const p = pattern || this.resolvePattern(vp);
    const energy = this.clamp01(brush.motion ?? vp.motionSpeed ?? 0.05);
    const profile = this.patternProfile(p, brush, energy, meta);

    const cluster = {
      cx,
      cy,
      pattern: p,
      meta: meta || {},
      t: Math.random() * 100,
      seed: Math.random() * 1000,
      baseRadius: profile.radius,
      particles: [],
      age: 0,
      maxAge: profile.maxAge
    };

    for (let i = 0; i < profile.count; i += 1) {
      cluster.particles.push(this.spawnParticle(cluster, true, null, profile));
    }

    this.clusters.push(cluster);
    while (this.clusters.length > this.maxClusters) {
      this.clusters.shift();
    }
  }

  patternProfile(pattern, brush, energy, meta) {
    // Within-class knobs from acoustic mapping (not a single "intensity").
    const d = this.clamp01(brush.spawnRate ?? brush.density ?? brush.particleDensity ?? 0.35);
    const scale = this.clamp01(
      brush.brushSize ?? brush.scaleResponse ?? brush.strokeWidth ?? 0.35
    );
    const motion = this.clamp01(brush.movementSpeed ?? brush.motion ?? brush.localMotion ?? energy ?? 0.35);
    const turb = this.clamp01(brush.turbulence ?? 0.35);
    const particleSize = this.clamp01(brush.particleSize ?? (1 - scale) * 0.5 + 0.25);
    const gap = this.clamp01(brush.gapProbability ?? 0.3);
    const trail = this.clamp01(brush.trailLength ?? brush.continuity ?? 0.4);
    const vibAmp = this.clamp01(brush.vibrationAmplitude ?? turb * 0.5);
    const vibFreq = this.clamp01(brush.vibrationFrequency ?? brush.pulseRate ?? brush.rotationSpeed ?? 0.4);
    const expand = this.clamp01(brush.expansion ?? scale);
    switch (pattern) {
      case "scatter_points":
        return {
          count: Math.floor(lerp(36, 110, d)),
          radius: lerp(8, 20, scale) * lerp(0.75, 1.15, 1 - particleSize),
          maxAge: lerp(0.7, 1.15, trail),
          pointAlpha: Math.floor(lerp(22, 40, 1 - gap)),
          trailFade: Math.floor(lerp(6, 16, 1 - trail)),
          hopRate: lerp(0.006, 0.028, motion) * lerp(0.8, 1.4, gap),
          jitter: turb,
          vibAmp,
          vibFreq
        };
      case "wave_ripple":
        return {
          count: Math.floor(lerp(160, 300, d)),
          radius: lerp(18, 44, scale) * lerp(0.9, 1.25, expand),
          maxAge: lerp(0.85, 1.2, trail),
          pointAlpha: 16,
          trailFade: Math.floor(lerp(8, 18, 1 - trail)),
          waveFreq: lerp(0.04, 0.14, vibFreq) * lerp(0.85, 1.2, motion),
          jitter: turb,
          vibAmp
        };
      case "impact_burst":
        return {
          count: Math.floor(lerp(100, 280, d)),
          radius: (meta?.half ? lerp(12, 30, scale) : lerp(24, 56, scale)) * lerp(0.85, 1.35, expand),
          maxAge: meta?.burst ? lerp(0.4, 0.7, trail) : lerp(0.28, 0.5, trail),
          pointAlpha: 32,
          trailFade: Math.floor(lerp(14, 28, gap)),
          burstForce: (meta?.burst ? lerp(1.0, 1.7, expand) : lerp(0.55, 1.15, expand)) * lerp(0.9, 1.25, motion),
          jitter: turb,
          vibAmp,
          vibFreq
        };
      case "pulse_grid":
        return {
          count: Math.floor(lerp(90, 220, d)),
          radius: lerp(12, 32, scale) * lerp(0.8, 1.1, 1 - particleSize),
          maxAge: 1,
          pointAlpha: 20,
          trailFade: Math.floor(lerp(9, 18, 1 - trail)),
          vibrateFreq: lerp(0.05, 0.18, vibFreq) * lerp(0.85, 1.3, vibAmp),
          spacing: lerp(0.7, 1.35, brush.spacing ?? (1 - d)),
          jitter: turb,
          vibAmp,
          vibFreq
        };
      default:
        return {
          count: Math.floor(lerp(220, this.particlesPerCluster, d)),
          radius: lerp(22, 48, scale),
          maxAge: lerp(0.85, 1.15, trail),
          pointAlpha: this.POINT_ALPHA,
          trailFade: Math.floor(lerp(8, this.TRAIL_FADE + 4, 1 - trail)),
          flowStrength: lerp(0.65, 1.35, motion) * lerp(0.85, 1.2, trail),
          jitter: turb,
          vibAmp,
          vibFreq
        };
    }
  }

  addEraseStroke(x, y, previousX, previousY) {
    const dist = Math.hypot(x - previousX, y - previousY);
    const steps = Math.max(1, Math.floor(dist / 10));
    const vol = this.smoothed.volume;
    const breath = lerp(28, 56, vol);

    for (let i = 0; i <= steps; i += 1) {
      const t = steps > 0 ? i / steps : 0;
      const cx = lerp(previousX, x, t);
      const cy = lerp(previousY, y, t);
      const rings = Math.random() < 0.35 ? 2 : 1;
      for (let r = 0; r < rings; r += 1) {
        this.eraseWaves.push({
          cx: cx + randomGaussian(0, 4),
          cy: cy + randomGaussian(0, 4),
          radius: breath * 0.15,
          maxRadius: breath * lerp(0.85, 1.25, Math.random()),
          age: 0,
          life: lerp(0.45, 0.85, Math.random()),
          seed: Math.random() * 1000,
          spiral: Math.random() * TWO_PI,
          strength: lerp(0.55, 1, vol + 0.2),
          stipple: Math.floor(lerp(10, 22, vol))
        });
      }
    }
    while (this.eraseWaves.length > 48) this.eraseWaves.shift();
  }

  updateEraseWaves(persistentGraphics) {
    if (!persistentGraphics || !this.eraseWaves.length) return;
    const ctx = persistentGraphics.drawingContext;
    const vol = this.smoothed.volume;

    for (let i = this.eraseWaves.length - 1; i >= 0; i -= 1) {
      const w = this.eraseWaves[i];
      w.age += 0.016;
      const progress = w.age / w.life;
      if (progress >= 1) {
        this.eraseWaves.splice(i, 1);
        continue;
      }

      w.radius = lerp(w.maxRadius * 0.12, w.maxRadius, progress);
      w.spiral += 0.09 + vol * 0.06;

      ctx.save();
      ctx.globalCompositeOperation = "destination-out";

      const edgeSoft = lerp(18, 42, 1 - progress);
      const ringAlpha = w.strength * lerp(0.22, 0.08, progress);
      persistentGraphics.noStroke();
      for (let s = 0; s < w.stipple; s += 1) {
        const a = w.spiral + (s / w.stipple) * TWO_PI * 2;
        const wobble = noise(w.seed + s * 0.17, w.age * 2.1) * edgeSoft;
        const rr = w.radius + wobble;
        const px = w.cx + Math.cos(a) * rr;
        const py = w.cy + Math.sin(a) * rr;
        const dot = lerp(2.5, 6.5, vol) * (0.6 + noise(px * 0.02, py * 0.02) * 0.8);
        persistentGraphics.fill(0, 0, 0, ringAlpha * 255);
        persistentGraphics.circle(px, py, dot);
      }

      const coreFade = ringAlpha * lerp(0.35, 0.12, progress);
      const grad = ctx.createRadialGradient(w.cx, w.cy, 0, w.cx, w.cy, w.radius * 0.65);
      grad.addColorStop(0, `rgba(0,0,0,${coreFade})`);
      grad.addColorStop(0.55, `rgba(0,0,0,${coreFade * 0.45})`);
      grad.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(w.cx, w.cy, w.radius * 0.65, 0, TWO_PI);
      ctx.fill();

      ctx.restore();
    }
  }

  commitLiveTo(persistentGraphics, liveGraphics) {
    if (!persistentGraphics || !liveGraphics) return;
    const ctx = persistentGraphics.drawingContext;
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    persistentGraphics.image(liveGraphics, 0, 0);
    ctx.restore();
    liveGraphics.clear();
    this.clusters = [];
    this.pulsePhase = 0;
    this.wavePhase = 0;
    this.scatterHop = 0;
  }

  updateAndDraw(graphics, visualParameters, personality, aiResult, options) {
    if (!graphics) return;
    this.updateAudioFeatures(visualParameters, personality, aiResult);
    const vp = visualParameters || window.activeFusedVisualParams || {};
    const pattern = this.resolvePattern(vp);
    const palette = this.resolvePalette(visualParameters);
    const ink = this.resolveInkColor({ ...vp, palette });
    const ctx = graphics.drawingContext;
    const profile = this.patternProfile(pattern, window.activeBrushParams || {}, this.smoothed.volume);
    const opts = options || {};
    const fade = opts.trailFade != null
      ? opts.trailFade
      : (this.persistStrokes ? this.LIVE_TRAIL_FADE : (profile.trailFade ?? this.TRAIL_FADE));

    if (fade > 0) {
      ctx.save();
      ctx.globalCompositeOperation = "destination-out";
      graphics.noStroke();
      graphics.fill(0, 0, 0, fade);
      graphics.rect(0, 0, graphics.width, graphics.height);
      ctx.restore();
    }

    const alpha = profile.pointAlpha ?? this.POINT_ALPHA;
    const boost = this.esp32FlashBoost || 0;

    for (const cluster of this.clusters) {
      cluster.age += 0.016;
      const field = this.computeClusterField(cluster);
      this.updateClusterParticles(cluster, field);
      if (cluster.maxAge < 1 && cluster.age > cluster.maxAge) continue;

      const pat = cluster.pattern || pattern;
      const burst = pat === "impact_burst" && cluster.age < 0.08;
      for (const p of cluster.particles) {
        const c = this.particleColor(palette, p, ink);
        const a = (burst ? alpha + 40 : alpha) + boost;
        this.drawParticle(graphics, p, c, a, pat, burst);
      }
    }
  }

  drawParticle(graphics, p, c, alpha, pattern, burst) {
    switch (pattern) {
      case "scatter_points": {
        graphics.noStroke();
        graphics.fill(c.r, c.g, c.b, alpha + 12);
        const sz = 1.6 + (p.orbit || 0.5) * 1.4;
        graphics.circle(p.x, p.y, sz);
        if (Math.random() < 0.08) {
          graphics.fill(Math.min(255, c.r + 40), Math.min(255, c.g + 30), c.b, alpha + 30);
          graphics.circle(p.x, p.y, sz * 0.45);
        }
        break;
      }
      case "wave_ripple": {
        graphics.stroke(c.r, c.g, c.b, alpha);
        graphics.strokeWeight(1.2);
        graphics.point(p.x, p.y);
        if (p.prevX != null && p.life > 0.4) {
          graphics.stroke(c.r, c.g, c.b, alpha * 0.55);
          graphics.line(p.prevX, p.prevY, p.x, p.y);
        }
        break;
      }
      case "impact_burst": {
        graphics.noStroke();
        graphics.fill(c.r, c.g, c.b, burst ? alpha + 25 : alpha * 0.85);
        const r = burst ? 2.2 + p.radialWeight * 2.5 : 1.2 + p.radialWeight;
        graphics.circle(p.x, p.y, r);
        if (burst && p.radialWeight > 1.1) {
          graphics.stroke(c.r, c.g, c.b, alpha * 0.4);
          graphics.strokeWeight(0.8);
          graphics.point(p.x + p.vx * 3, p.y + p.vy * 3);
        }
        break;
      }
      case "pulse_grid": {
        graphics.stroke(c.r, c.g, c.b, alpha);
        graphics.strokeWeight(1);
        graphics.point(p.x, p.y);
        if (Math.floor(p.colorSeed) % 4 === 0) {
          graphics.stroke(Math.min(255, c.r + 35), Math.min(255, c.g + 20), c.b, alpha * 0.65);
          graphics.point(p.x + 2, p.y);
          graphics.point(p.x, p.y + 2);
        }
        break;
      }
      default: {
        graphics.stroke(c.r, c.g, c.b, alpha);
        graphics.strokeWeight(1);
        graphics.point(p.x, p.y);
        if (this.smoothed.high > 0.25 && Math.random() < 0.04) {
          graphics.stroke(Math.min(255, c.r + 25), Math.min(255, c.g + 15), Math.min(255, c.b + 20), alpha * 0.7);
          graphics.point(p.x + p.vx, p.y + p.vy);
        }
      }
    }
  }

  updateAudioFeatures(visualParameters, personality, aiResult) {
    const analysed = window.activeAudioFeatures || {};
    const py = window.pythonEnhancedFeatures;
    const merged = py ? FeatureSchema.mergeFeatures(analysed, py, 0.35) : analysed;
    const vp = visualParameters || {};
    const p = personality || {};
    const brush = window.activeBrushParams || {};

    const fallbackVolume = merged.volume ?? brush.motion ?? vp.motionSpeed ?? p.energy ?? 0.05;
    const profile = merged.spectrumProfile || [];
    const fallbackLow = merged.bass ?? this.profileBand(profile, 0, 0.18) ?? vp.particleDensity ?? 0.08;
    const fallbackMid = merged.mid ?? this.profileBand(profile, 0.18, 0.58) ?? vp.shapeComplexity ?? 0.08;
    const fallbackHigh = merged.treble ?? this.profileBand(profile, 0.58, 1) ?? vp.colorVariation ?? 0.06;
    const fallbackCentroid = merged.pitch ?? vp.directionChange ?? 0.08;

    let volume = this.clamp01(fallbackVolume);
    let low = this.clamp01(fallbackLow);
    let mid = this.clamp01(fallbackMid);
    let high = this.clamp01(fallbackHigh);
    let centroid = this.clamp01(fallbackCentroid);

    const esp32 = window.esp32AudioAdapter;
    if (esp32 && esp32.isConnected()) {
      const live = esp32.getVisualFeatures();
      volume = Math.max(volume, live.volume);
      low = Math.max(low, live.low);
      mid = Math.max(mid, live.mid);
      high = Math.max(high, live.high);
      centroid = Math.max(centroid, live.centroid);
      this.esp32FlashBoost = live.flashBoost;
      this.esp32Drift = live.meanSigned || 0;
    } else {
      this.esp32FlashBoost = 0;
      this.esp32Drift = 0;
    }

    this.smoothed.volume = lerp(this.smoothed.volume, volume, 0.07);
    this.smoothed.low = lerp(this.smoothed.low, low, 0.06);
    this.smoothed.mid = lerp(this.smoothed.mid, mid, 0.07);
    this.smoothed.high = lerp(this.smoothed.high, high, 0.08);
    this.smoothed.centroid = lerp(this.smoothed.centroid, centroid, 0.06);
  }

  computeClusterField(cluster) {
    const brush = window.activeBrushParams || {};
    const vol = this.clamp01(brush.brushSize ?? brush.scaleResponse ?? this.smoothed.volume);
    const move = this.clamp01(brush.movementSpeed ?? brush.motion ?? this.smoothed.centroid);
    const turb = this.clamp01(brush.turbulence ?? brush.jitter ?? this.smoothed.high);
    const vibAmp = this.clamp01(brush.vibrationAmplitude ?? turb * 0.5);
    const vibFreq = this.clamp01(brush.vibrationFrequency ?? brush.pulseRate ?? 0.4);
    const vibRand = this.clamp01(brush.vibrationRandomness ?? turb * 0.6);
    const low = this.smoothed.low;
    const high = this.smoothed.high;
    const centroid = this.smoothed.centroid;
    const pattern = cluster.pattern || "flow_field";
    const profile = this.patternProfile(pattern, brush, move, cluster.meta);
    const minSide = cluster.baseRadius * 2.4;
    const baseRadius = cluster.baseRadius * lerp(0.55, 1.15, vol);

    let centripetal = lerp(0.028, 0.004, move);
    const burstBoost = Math.max(0, (Number(profile.burstForce) || 1) - 1) * 0.15;
    let centrifugal = vol * 0.22 + burstBoost;
    let noiseScale = lerp(0.006, 0.048, turb * 0.55 + centroid * 0.25 + high * 0.2);
    let noiseForce = lerp(0.03, 0.48, turb * 0.6 + vibAmp * 0.3 + low * 0.1);

    if (pattern === "scatter_points") {
      centripetal = lerp(0.04, 0.012, move);
      centrifugal = vol * 0.1 + vibAmp * 0.08;
      noiseForce *= lerp(0.2, 0.55, vibRand);
    } else if (pattern === "flow_field") {
      noiseForce = lerp(0.08, 0.58, turb);
      centripetal = lerp(0.018, 0.003, move);
    } else if (pattern === "wave_ripple") {
      noiseForce = lerp(0.04, 0.32, turb * 0.7 + vibAmp * 0.3);
      centripetal = lerp(0.022, 0.006, move);
    } else if (pattern === "impact_burst") {
      centripetal = lerp(0.008, 0.002, move);
      centrifugal = (brush.expansion ?? vol) * 0.9 * (profile.burstForce || 1);
      noiseForce *= lerp(0.12, 0.35, vibRand);
    } else if (pattern === "pulse_grid") {
      noiseForce = lerp(0.05, 0.36, turb);
      centripetal = lerp(0.03, 0.01, move);
    }

    cluster.t += 0.003 + move * 0.012 + vibFreq * 0.01 + (this.esp32Drift || 0) * 0.003;

    return {
      cx: cluster.cx,
      cy: cluster.cy,
      pattern,
      waveAngle: cluster.meta?.waveAngle ?? 0,
      waveAmp: (cluster.meta?.waveAmp ?? 12) * lerp(0.7, 1.4, vibAmp),
      waveFreq: profile.waveFreq ?? 0.08,
      vibrateFreq: profile.vibrateFreq ?? lerp(0.06, 0.16, vibFreq),
      burstForce: profile.burstForce ?? 1,
      hopRate: profile.hopRate ?? 0,
      minSide,
      low,
      high,
      baseRadius,
      centripetal,
      centrifugal,
      noiseScale,
      noiseForce,
      vibAmp,
      vibFreq,
      vibRand,
      respawnSigma: cluster.baseRadius * lerp(0.28, 0.55, brush.gapProbability ?? vol),
      maxDist: cluster.baseRadius * (pattern === "impact_burst" ? 1.8 : 1.05),
      seed: cluster.seed,
      t: cluster.t
    };
  }

  sampleNoiseFlow(p, field) {
    const nx = p.x * field.noiseScale + field.seed * 11.3;
    const ny = p.y * field.noiseScale - field.seed * 5.7;
    const nz = field.t + p.noiseOffset * 0.0015;
    const n1 = noise(nx, ny, nz);
    const n2 = noise(nx * 2.1 + 19, ny * 2.1 - 11, nz * 0.85);
    const angle = (n1 * 0.72 + n2 * 0.28) * TWO_PI * 2;
    const force = field.noiseForce * p.flowWeight;
    let fx = Math.cos(angle) * force;
    let fy = Math.sin(angle) * force;

    const dx = p.x - field.cx;
    const dy = p.y - field.cy;
    const dist = Math.sqrt(dx * dx + dy * dy) + 0.001;
    const vortex = field.low * 0.0011 * field.minSide;
    fx += (-dy / dist) * vortex * p.vortexWeight;
    fy += (dx / dist) * vortex * p.vortexWeight;
    return { fx, fy };
  }

  updateClusterParticles(cluster, field) {
    for (const p of cluster.particles) {
      const dx = p.x - field.cx;
      const dy = p.y - field.cy;
      const dist = Math.sqrt(dx * dx + dy * dy) + 0.001;
      const nx = dx / dist;
      const ny = dy / dist;

      const homeDist = field.baseRadius * p.orbit;
      const homeX = field.cx + Math.cos(p.homeAngle) * homeDist;
      const homeY = field.cy + Math.sin(p.homeAngle) * homeDist;

      p.vx += (homeX - p.x) * field.centripetal * p.springWeight;
      p.vy += (homeY - p.y) * field.centripetal * p.springWeight;
      p.vx += nx * field.centrifugal * p.radialWeight;
      p.vy += ny * field.centrifugal * p.radialWeight;

      const flow = this.sampleNoiseFlow(p, field);
      p.vx += flow.fx;
      p.vy += flow.fy;

      this.applyPatternForces(p, field);

      p.vx *= p.damping;
      p.vy *= p.damping;
      p.prevX = p.x;
      p.prevY = p.y;
      p.x += p.vx;
      p.y += p.vy;

      const lifeDecay = field.pattern === "impact_burst"
        ? 0.0025 + field.high * 0.0018
        : 0.00065 + field.high * 0.00045;
      p.life -= lifeDecay;

      if (field.pattern === "scatter_points" && Math.random() < field.hopRate) {
        p.x += randomGaussian(0, field.baseRadius * 0.35);
        p.y += randomGaussian(0, field.baseRadius * 0.35);
        p.life = Math.min(1, p.life + 0.2);
      }

      if (dist > field.maxDist * 1.2 || p.life <= 0) {
        Object.assign(p, this.spawnParticle(cluster, false, field));
      }
    }
  }

  applyPatternForces(p, field) {
    switch (field.pattern) {
      case "wave_ripple": {
        const perpX = -Math.sin(field.waveAngle);
        const perpY = Math.cos(field.waveAngle);
        const wave = Math.sin(field.t * 3.2 + p.noiseOffset * 0.01) * field.waveAmp * field.waveFreq;
        p.vx += perpX * wave * 0.04;
        p.vy += perpY * wave * 0.04;
        const alongX = Math.cos(field.waveAngle);
        const alongY = Math.sin(field.waveAngle);
        p.vx += alongX * field.low * 0.006;
        p.vy += alongY * field.low * 0.006;
        break;
      }
      case "impact_burst": {
        const dx = p.x - field.cx;
        const dy = p.y - field.cy;
        const dist = Math.sqrt(dx * dx + dy * dy) + 0.001;
        const impulse = field.burstForce * 0.018 * (1 - Math.min(1, dist / field.maxDist));
        p.vx += (dx / dist) * impulse * p.radialWeight;
        p.vy += (dy / dist) * impulse * p.radialWeight;
        break;
      }
      case "pulse_grid": {
        const vib = Math.sin(field.t * 8 + p.gridPhase) * field.vibrateFreq * field.minSide;
        p.vx += Math.cos(p.gridAngle) * vib * 0.003;
        p.vy += Math.sin(p.gridAngle) * vib * 0.003;
        break;
      }
      default:
        break;
    }
  }

  spawnParticle(cluster, initial, field, profileOverride) {
    const pattern = cluster.pattern || "flow_field";
    const profile = profileOverride || (field
      ? this.patternProfile(pattern, window.activeBrushParams || {}, this.smoothed.volume, cluster.meta)
      : this.patternProfile(pattern, window.activeBrushParams || {}, 0.05, cluster.meta));
    const sigma = field ? field.respawnSigma : cluster.baseRadius * 0.35;
    let r = Math.abs(randomGaussian(0, sigma));
    let angle = Math.random() * TWO_PI;

    if (pattern === "pulse_grid") {
      const row = Math.floor(Math.random() * 4);
      const col = (Math.random() - 0.5) * 2;
      r = Math.abs(col) * cluster.baseRadius * 0.45;
      angle = (row / 4) * TWO_PI;
    } else if (pattern === "scatter_points") {
      r = Math.abs(randomGaussian(0, sigma * 0.6));
    } else if (pattern === "impact_burst" && initial) {
      r = Math.random() * cluster.baseRadius * 0.15;
    }

    const x = cluster.cx + Math.cos(angle) * r;
    const y = cluster.cy + Math.sin(angle) * r;
    const orbit = this.constrain(Math.abs(randomGaussian(0, 0.38)) + Math.random() * 0.12, 0.02, 1);

    const burstSpeed = pattern === "impact_burst" && initial ? lerp(0.15, 0.55, Math.random()) : 0.04;
    const radialW = pattern === "impact_burst" ? lerp(1.2, 2.2, Math.random()) : lerp(0.5, 1.3, Math.random());
    const damp = pattern === "scatter_points"
      ? lerp(0.92, 0.96, Math.random())
      : pattern === "impact_burst"
        ? lerp(0.94, 0.97, Math.random())
        : lerp(0.968, 0.988, Math.random());

    return {
      x,
      y,
      prevX: x,
      prevY: y,
      vx: initial ? Math.cos(angle) * burstSpeed * radialW : 0,
      vy: initial ? Math.sin(angle) * burstSpeed * radialW : 0,
      homeAngle: angle,
      orbit,
      noiseOffset: Math.random() * 1000 + cluster.seed * 37,
      colorSeed: Math.random() * 50,
      gridPhase: Math.random() * TWO_PI,
      gridAngle: angle,
      life: pattern === "impact_burst" ? lerp(0.5, 0.9, Math.random()) : lerp(0.75, 1, Math.random()),
      flowWeight: pattern === "flow_field"
        ? lerp(0.7, 1.3, Math.random())
        : lerp(0.4, 1.1, Math.random()),
      vortexWeight: lerp(0.3, 1.0, Math.random()),
      springWeight: lerp(0.6, 1.2, Math.random()),
      radialWeight: radialW,
      damping: damp
    };
  }

  resetInkColor(initial) {
    const c = initial || { r: 120, g: 115, b: 110 };
    this.smoothedInk = { r: c.r, g: c.g, b: c.b };
  }

  particleColor(palette, particle, fallbackInk) {
    if (!palette.length) return fallbackInk;
    // Spread seeds across full palette — avoid clustering on first warm swatch.
    const af = window.activeAcousticFeatures || {};
    const spread =
      (this.smoothed.centroid || 0) * 1.2
      + (this.smoothed.high || 0) * 0.9
      + (af.spectralCentroid || 0) * 1.4
      + (af.trebleRatio || 0) * 1.1
      + (particle.orbit || 0) * 2.2;
    const idx = Math.floor(Math.abs(particle.colorSeed * 1.7 + spread * 3.1)) % palette.length;
    const base = palette[idx];
    if (typeof SoundColorEngine === "undefined") return base;
    // Light modulate — heavy warm push was washing cool hues into gold mud.
    return SoundColorEngine.liveModulate(base, {
      bass: this.smoothed.low,
      mid: this.smoothed.mid,
      treble: this.smoothed.high,
      volume: this.smoothed.volume
    }, 0.12);
  }

  resolveInkColor(visualParameters) {
    const vp = visualParameters || {};
    const palette = this.resolvePalette(vp);
    let target = { r: 140, g: 120, b: 180 };
    if (palette.length) {
      const idx = this.inkIndexFromAudio(palette.length);
      target = { ...palette[idx] };
    }
    this.smoothedInk.r = lerp(this.smoothedInk.r, target.r, 0.22);
    this.smoothedInk.g = lerp(this.smoothedInk.g, target.g, 0.22);
    this.smoothedInk.b = lerp(this.smoothedInk.b, target.b, 0.22);
    return this.smoothedInk;
  }

  inkIndexFromAudio(paletteLen) {
    const t = this.smoothed.treble;
    const m = this.smoothed.mid;
    const l = this.smoothed.low;
    const mix = t * 0.45 + m * 0.35 + l * 0.2;
    return Math.min(paletteLen - 1, Math.floor(mix * paletteLen));
  }

  applyPaletteBias(c, bias) {
    const clamp = (v) => Math.min(255, Math.max(0, v));
    switch (bias) {
      case "bright_warm":
        return { r: clamp(c.r * 0.85 + 55), g: clamp(c.g * 0.9 + 35), b: clamp(c.b * 0.65 + 10) };
      case "cool_muted":
        return { r: clamp(c.r * 0.55 + 75), g: clamp(c.g * 0.62 + 82), b: clamp(c.b * 0.58 + 72) };
      case "cool_blue_green":
        return { r: clamp(c.r * 0.45 + 22), g: clamp(c.g * 0.88 + 48), b: clamp(c.b * 0.95 + 42) };
      case "earth_contrast":
        return { r: clamp(c.r * 0.92 + 48), g: clamp(c.g * 0.72 + 32), b: clamp(c.b * 0.5 + 18) };
      case "mid_high_buzz":
        return { r: clamp(c.r * 0.78 + 42), g: clamp(c.g * 0.82 + 52), b: clamp(c.b * 0.92 + 35) };
      default:
        return c;
    }
  }

  profileBand(profile, from, to) {
    if (!profile || !profile.length) return 0;
    const start = Math.floor(profile.length * from);
    const end = Math.max(start + 1, Math.floor(profile.length * to));
    let sum = 0;
    for (let i = start; i < end; i += 1) sum += profile[i] || 0;
    return this.clamp01(sum / (end - start));
  }

  constrain(v, min, max) { return Math.min(max, Math.max(min, v)); }
  clamp01(v) { return Math.min(1, Math.max(0, v || 0)); }
}

window.BrushGenerator = BrushGenerator;
