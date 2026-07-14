// SoundMembraneSphere — layered translucent noisy membrane sphere.
// Three.js + THREE.Points + BufferGeometry + ShaderMaterial.
//
// Motion layers:
//   1. Global drift rotation (group.rotation, organic not mechanical)
//   2. Global + per-layer breathing (shader u_breathAmp)
//   3. Shell flow (mid-driven FBM, per-layer desync)
//   4. Localized bursts (transient / spectral flux + region mask)

const TUNING = {
  rotationSpeedY: 0.048,       // 主 Y 自转速度
  rotationTiltX: 0.22,         // 固定倾角，让自转更易被看见
  rotationDriftX: 0.09,        // X 漂浮摆动
  rotationDriftZ: 0.045,       // Z 摆动
  rotationShaderDrift: 0.38,   // shader 内切向漂移（配合扩散）
  rotationLayerDesync: 0.35,   // 内外层转速差
  shuttleCount: 1200,          // 层间穿梭粒子
  coreShuttleCount: 950,       // 穿越圆心的穿梭粒子
  shuttleSpeed: 0.58,          // 穿梭速度
  shuttleBreakout: 0.15,       // 略微突破外壳的幅度
  shapeLumpBase: 0.14,         // 区域性凸起/凹陷基础幅度
  shapeLumpAudio: 0.38,        // 节奏驱动凹凸
  rhythmPulseGain: 0.55,       // 节拍冲击增益
  breathRate: 0.62,            // 呼吸频率
  breathAmpIdle: 0.085,        // 无音频时呼吸幅度
  breathAmpAudio: 0.32,        // 低频增强呼吸
  microBreathScale: 0.055,     // 全局微缩放
  localBurstStrength: 0.42,
  flowSpeedBase: 0.32,
  noiseAmpBase: 0.52,
  particleBrightness: 1.38,
  particleAlphaGain: 1.45,
  bloomStrengthBase: 0.19,
  bloomExtractStrength: 0.34,
  bloomThreshold: 0.58,
  fluxSensitivity: 3.0,
  transientDecay: 0.82,
  audioLerp: 0.34,             // 实时 FFT 跟随速度
  audioAttackBass: 0.58,
  audioReleaseBass: 0.17,
  audioAttackTreble: 0.65,
  audioReleaseTreble: 0.19,
  // GPU / 帧率
  pixelRatioMax: 1.35,
  postBloom: true,
  bloomRtScale: 0.32,
  shellParticleCount: 12800,
  innerParticleCount: 2600,
  veilParticleCount: 4400,
  fbmOctaves: 3,
  enableShapeMorph: false,
  shapeMorphStrength: 0.0
};

class SoundMembraneSphere {
  constructor(container, options = {}) {
    this.container = container || document.body;
    this.seed = options.seed || 1;

    this.ready = false;
    this.running = false;
    this._raf = null;
    this._lastW = 0;
    this._lastH = 0;
    this._frameIdx = 0;
    this._avgFrameMs = 16;
    this._livePixelRatio = TUNING.pixelRatioMax;

    // Smoothed audio drivers (always have a baseline so the sphere is alive).
    this.smoothed = {
      bass: 0.1, lowMid: 0.09, mid: 0.1, treble: 0.08,
      bassPeak: 0, treblePeak: 0,
      level: 0.1, transient: 0, flux: 0
    };
    this._externalAudio = null;
    this.acousticDriver = null;
    this._latestAcousticFrame = null;
    this.enableShapeMorph = options.enableShapeMorph ?? TUNING.enableShapeMorph;
    this.shapeMorphStrength = options.shapeMorphStrength ?? TUNING.shapeMorphStrength;
    this.shapeMorph = {
      enabled: false,
      currentStrength: 0,
      targetStrength: 0,
      profile: null,
      archetype: null
    };
    this._prevSpectrum = null;
    this._burstEnvelope = 0;
    this._prevLevel = 0.1;
    this._lastHookedAudio = null;
    this._lastAttachedAnalyser = null;
    this._paletteSlots = this._defaultPaletteSlots();

    this.playbackAnalyzer = typeof PlaybackAnalyzer !== "undefined" ? new PlaybackAnalyzer() : null;
    this.audio = this._setupP5Audio();
    this.init();
  }

  // ---------------------------------------------------------------- init

  init() {
    if (typeof THREE === "undefined") {
      console.error("SoundMembraneSphere requires THREE.js to be loaded first.");
      return;
    }

    this.clock = new THREE.Clock();

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000);

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    this.camera.position.set(0, 0, 3.6);
    this.camera.lookAt(0, 0, 0);

    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      alpha: false,
      powerPreference: "high-performance",
      stencil: false,
      depth: true,
      desynchronized: true,
      preserveDrawingBuffer: false
    });
    this.renderer.setClearColor(0x000000, 1);
    this._applyPixelRatio(TUNING.pixelRatioMax);

    this.canvas = this.renderer.domElement;
    this.canvas.style.display = "block";
    this.canvas.style.width = "100%";
    this.canvas.style.height = "100%";
    this.canvas.style.pointerEvents = "none"; // never draggable
    this.container.appendChild(this.canvas);

    this.createParticles();
    this.createShaderMaterial();
    this._syncPaletteFromSource();

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = true;
    this.geometry.computeBoundingSphere();

    // 旋转组：轻微倾角 + 持续自转，与扩散/呼吸叠加
    this.rotationGroup = new THREE.Group();
    this.rotationGroup.rotation.x = TUNING.rotationTiltX;
    this.rotationGroup.add(this.points);
    this.scene.add(this.rotationGroup);
    this._spinAngle = 0;

    this._buildBloom();

    // Initial sizing from the container.
    const w = this.container.clientWidth || 320;
    const h = this.container.clientHeight || 320;
    this.resize(w, h);

    this.ready = true;
    this.running = true;
    this.animate();

    console.log("SoundMembraneSphere initialized");
    console.log("particle count:", this.particleCount);
    console.log("animation loop running:", this.running);
  }

  // ---------------------------------------------------------- geometry

  createParticles() {
    // Three shell-biased layers — NOT a cube of random points.
    const layers = [
      { layer: 0, count: TUNING.innerParticleCount, rMin: 0.45, rMax: 0.72, intensity: 0.32 },
      { layer: 1, count: TUNING.shellParticleCount, rMin: 0.82, rMax: 1.05, intensity: 1.0 },
      { layer: 2, count: TUNING.veilParticleCount, rMin: 1.05, rMax: 1.24, intensity: 0.55 },
      { layer: 3, count: TUNING.shuttleCount, rMin: 0.88, rMax: 1.08, intensity: 0.72 }, // D corridor shuttle
      { layer: 4, count: TUNING.coreShuttleCount, rMin: 0.75, rMax: 1.12, intensity: 0.8 } // E core-crossing shuttle
    ];

    const total = layers.reduce((s, l) => s + l.count, 0);
    this.particleCount = total;

    const positions = new Float32Array(total * 3);
    const normals = new Float32Array(total * 3);
    const seeds = new Float32Array(total);
    const layerAttr = new Float32Array(total);
    const shellFactors = new Float32Array(total);
    const intensities = new Float32Array(total);
    const localPhases = new Float32Array(total);   // per-particle phase -> asymmetry
    const regionSeeds = new Float32Array(total);    // spatial region grouping for local bursts
    const colorTs = new Float32Array(total);          // palette sample position 0..1

    const rng = this._seededRandom(this.seed * 9973 + 17);
    let i = 0;

    for (const spec of layers) {
      for (let k = 0; k < spec.count; k += 1, i += 1) {
        // Uniform direction on the sphere.
        const theta = rng() * Math.PI * 2;
        const phi = Math.acos(2 * rng() - 1);
        const sinPhi = Math.sin(phi);

        const dx = sinPhi * Math.cos(theta);
        const dy = sinPhi * Math.sin(theta);
        const dz = Math.cos(phi);

        // Bias radius toward the outer edge of the layer band.
        const shellT = Math.pow(rng(), 0.4);
        const radius = spec.rMin + shellT * (spec.rMax - spec.rMin);

        positions[i * 3 + 0] = dx * radius;
        positions[i * 3 + 1] = dy * radius;
        positions[i * 3 + 2] = dz * radius;

        normals[i * 3 + 0] = dx;
        normals[i * 3 + 1] = dy;
        normals[i * 3 + 2] = dz;

        seeds[i] = rng() * 1000.0;
        layerAttr[i] = spec.layer;
        // Normalized 0..1 where 1 == outer shell radius (1.24).
        shellFactors[i] = radius / 1.24;
        intensities[i] = spec.intensity * (0.7 + rng() * 0.3);
        localPhases[i] = rng() * Math.PI * 2.0;
        regionSeeds[i] = rng();
        colorTs[i] = (rng() * 0.75 + shellT * 0.2 + spec.layer * 0.05) % 1.0;
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("aNormal", new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
    geometry.setAttribute("aLayer", new THREE.BufferAttribute(layerAttr, 1));
    geometry.setAttribute("aShellFactor", new THREE.BufferAttribute(shellFactors, 1));
    geometry.setAttribute("aIntensity", new THREE.BufferAttribute(intensities, 1));
    geometry.setAttribute("aLocalPhase", new THREE.BufferAttribute(localPhases, 1));
    geometry.setAttribute("aRegion", new THREE.BufferAttribute(regionSeeds, 1));
    geometry.setAttribute("aColorT", new THREE.BufferAttribute(colorTs, 1));

    this.geometry = geometry;
  }

  createShaderMaterial() {
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        u_time: { value: 0 },
        u_bass: { value: 0.1 },
        u_lowMid: { value: 0.09 },
        u_mid: { value: 0.1 },
        u_treble: { value: 0.08 },
        u_level: { value: 0.1 },
        u_transient: { value: 0 },
        u_flux: { value: 0 },
        u_noiseAmp: { value: TUNING.noiseAmpBase },
        u_flowSpeed: { value: TUNING.flowSpeedBase },
        u_breathAmp: { value: TUNING.breathAmpIdle },
        u_localBurstStrength: { value: TUNING.localBurstStrength },
        u_rotationDrift: { value: TUNING.rotationShaderDrift },
        u_shuttleSpeed: { value: TUNING.shuttleSpeed },
        u_shuttleBreakout: { value: TUNING.shuttleBreakout },
        u_shapeLump: { value: TUNING.shapeLumpBase },
        u_rhythmPulse: { value: 0 },
        u_waveEnvelope: { value: 0 },
        u_waveSlope: { value: 0 },
        u_spectrumBands: { value: new THREE.Vector4(0.25, 0.25, 0.25, 0.25) },
        u_spectrogramBands: { value: new THREE.Vector4(0.25, 0.25, 0.25, 0.25) },
        u_spectralCentroid: { value: 0.5 },
        u_spectralSpread: { value: 0.2 },
        u_spectralEntropy: { value: 0.3 },
        u_enableShapeMorph: { value: this.enableShapeMorph ? 1 : 0 },
        u_shapeMorphStrength: { value: 0 },
        u_plumeMix: { value: 0 },
        u_ribbonMix: { value: 0 },
        u_ringMix: { value: 0 },
        u_burstMix: { value: 0 },
        u_clusterMix: { value: 0 },
        u_shapeStretch: { value: new THREE.Vector3(1, 1, 1) },
        u_shapeTaper: { value: 0 },
        u_shapeTwist: { value: 0 },
        u_branchiness: { value: 0 },
        u_fragmentation: { value: 0 },
        u_shapeRoughness: { value: 0 },
        u_shapeDensity: { value: 0.5 },
        u_shapeSeed: { value: 0 },
        u_brightness: { value: TUNING.particleBrightness },
        u_alphaGain: { value: TUNING.particleAlphaGain },
        u_palette0: { value: this._paletteSlots[0].clone() },
        u_palette1: { value: this._paletteSlots[1].clone() },
        u_palette2: { value: this._paletteSlots[2].clone() },
        u_palette3: { value: this._paletteSlots[3].clone() },
        u_palette4: { value: this._paletteSlots[4].clone() },
        u_paletteCount: { value: 5 },
        u_particleSize: { value: 1.0 },
        u_pixelRatio: { value: this._livePixelRatio }
      },
      vertexShader: MEMBRANE_VERT.replace("FBM_OCTAVES", String(TUNING.fbmOctaves)),
      fragmentShader: MEMBRANE_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending
    });
  }

  // ------------------------------------------------------------- bloom

  _buildBloom() {
    this._sceneRT = this._makeRT(1, 1);
    this._bloomRT1 = this._makeRT(1, 1);
    this._bloomRT2 = this._makeRT(1, 1);

    this._quadScene = new THREE.Scene();
    this._quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quadGeo = new THREE.PlaneGeometry(2, 2);

    this._extractMat = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, u_threshold: { value: TUNING.bloomThreshold }, u_strength: { value: TUNING.bloomExtractStrength } },
      vertexShader: BLOOM_VERT,
      fragmentShader: BLOOM_EXTRACT_FRAG,
      depthWrite: false,
      depthTest: false
    });
    this._blur2dMat = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, u_resolution: { value: new THREE.Vector2(1, 1) } },
      vertexShader: BLOOM_VERT,
      fragmentShader: BLOOM_BLUR2D_FRAG,
      depthWrite: false,
      depthTest: false
    });
    this._compositeMat = new THREE.ShaderMaterial({
      uniforms: { tScene: { value: null }, tBloom: { value: null }, u_bloomStrength: { value: 0.32 } },
      vertexShader: BLOOM_VERT,
      fragmentShader: BLOOM_COMPOSITE_FRAG,
      depthWrite: false,
      depthTest: false
    });

    this._quadMesh = new THREE.Mesh(quadGeo, this._extractMat);
    this._quadScene.add(this._quadMesh);
  }

  _makeRT(w, h) {
    return new THREE.WebGLRenderTarget(w, h, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat
    });
  }

  _applyPixelRatio(pr) {
    const next = Math.min(window.devicePixelRatio || 1, Math.max(1, pr));
    if (Math.abs(next - this._livePixelRatio) < 0.01) return;
    this._livePixelRatio = next;
    if (this.renderer) this.renderer.setPixelRatio(next);
    if (this.material) this.material.uniforms.u_pixelRatio.value = next;
    if (this._lastW > 0 && this._lastH > 0) this.resize(this._lastW, this._lastH);
  }

  _updateAdaptiveQuality(dt) {
    this._avgFrameMs = this._avgFrameMs * 0.9 + dt * 1000 * 0.1;
    if (this._frameIdx % 24 !== 0) return;
    if (this._avgFrameMs > 22 && this._livePixelRatio > 1) {
      this._applyPixelRatio(this._livePixelRatio - 0.12);
    } else if (this._avgFrameMs < 15 && this._livePixelRatio < TUNING.pixelRatioMax) {
      this._applyPixelRatio(this._livePixelRatio + 0.06);
    }
  }

  // ------------------------------------------------------------ resize

  resize(w, h) {
    if (!this.renderer) return;
    const pw = Math.max(1, Math.floor(w));
    const ph = Math.max(1, Math.floor(h));
    if (pw === this._lastW && ph === this._lastH) return;
    this._lastW = pw;
    this._lastH = ph;

    this.renderer.setSize(pw, ph, false);
    this.canvas.style.width = "100%";
    this.canvas.style.height = "100%";

    const aspect = pw / ph;
    this.camera.aspect = aspect;

    // Keep the sphere fully framed regardless of portrait / landscape panels.
    const fitRadius = 1.55;
    const vFov = (this.camera.fov * Math.PI) / 180;
    const limiting = Math.min(1, aspect); // portrait -> width limited
    const dist = fitRadius / (Math.tan(vFov / 2) * limiting);
    this.camera.position.set(0, 0, Math.max(2.6, dist));
    this.camera.updateProjectionMatrix();

    const pr = this._livePixelRatio;
    const bloomScale = TUNING.bloomRtScale;
    const bw = Math.max(1, Math.floor(pw * pr * bloomScale));
    const bh = Math.max(1, Math.floor(ph * pr * bloomScale));
    const fw = Math.max(1, Math.floor(pw * pr));
    const fh = Math.max(1, Math.floor(ph * pr));
    this._sceneRT.setSize(fw, fh);
    this._bloomRT1.setSize(bw, bh);
    this._bloomRT2.setSize(bw, bh);
    this._blur2dMat.uniforms.u_resolution.value.set(bw, bh);
    this.material.uniforms.u_pixelRatio.value = pr;
  }

  // ----------------------------------------------------------- animate

  animate() {
    if (!this.running) return;
    this._raf = requestAnimationFrame(() => this.animate());

    this._frameIdx += 1;

    if (this._frameIdx % 8 === 0) {
      const cw = this.container.clientWidth;
      const ch = this.container.clientHeight;
      if (cw > 0 && ch > 0 && (cw !== this._lastW || ch !== this._lastH)) {
        this.resize(cw, ch);
      }
    }

    const elapsed = this.clock.getElapsedTime();
    const dt = Math.min(0.05, this.clock.getDelta());
    this._updateAdaptiveQuality(dt);
    this._pullAudio(elapsed, dt);
    this._syncPaletteFromSource();
    const shapeLerp = 1 - Math.exp(-dt * 4.5);
    this.shapeMorph.currentStrength +=
      (this.shapeMorph.targetStrength - this.shapeMorph.currentStrength) * shapeLerp;

    const s = this.smoothed;
    const u = this.material.uniforms;
    u.u_time.value = elapsed;
    u.u_bass.value = s.bass;
    u.u_lowMid.value = s.lowMid;
    u.u_mid.value = s.mid;
    u.u_treble.value = s.treble;
    u.u_level.value = s.level;
    u.u_transient.value = s.transient;
    u.u_flux.value = s.flux;
    u.u_noiseAmp.value = TUNING.noiseAmpBase + s.bass * 1.25 + s.bassPeak * 0.42;
    u.u_flowSpeed.value = TUNING.flowSpeedBase + s.mid * 0.85 + s.level * 0.15;
    u.u_breathAmp.value = TUNING.breathAmpIdle + s.bass * TUNING.breathAmpAudio + s.bassPeak * 0.18 + s.level * 0.06;
    u.u_localBurstStrength.value = TUNING.localBurstStrength * (0.4 + s.transient * 2.2 + s.flux * 1.4);
    u.u_particleSize.value = 0.92 + s.level * 0.58 + s.treble * 0.42 + s.treblePeak * 0.36;
    u.u_rotationDrift.value = TUNING.rotationShaderDrift * (0.7 + s.mid * 0.5 + s.level * 0.3);
    u.u_shuttleSpeed.value = TUNING.shuttleSpeed * (0.75 + s.mid * 0.55 + s.flux * 0.35 + s.treble * 0.25);
    u.u_shuttleBreakout.value = TUNING.shuttleBreakout * (0.55 + s.treble * 0.95 + s.treblePeak * 0.55 + s.transient * 0.35);
    const rhythm = Math.min(1, s.bassPeak * 0.55 + s.transient * 0.75 + s.flux * 0.35 + s.level * 0.2);
    u.u_rhythmPulse.value = rhythm;
    u.u_shapeLump.value = TUNING.shapeLumpBase + rhythm * TUNING.shapeLumpAudio + s.bass * 0.12;
    u.u_shapeMorphStrength.value = this.shapeMorph.currentStrength;
    u.u_enableShapeMorph.value = this.shapeMorph.currentStrength > 0.001 ? 1 : 0;

    const rotY = TUNING.rotationSpeedY * (0.85 + s.mid * 0.6 + s.level * 0.45 + s.bass * 0.5 + s.bassPeak * 0.25);
    this._spinAngle += rotY * dt;
    this.rotationGroup.rotation.y = this._spinAngle;
    this.rotationGroup.rotation.x = TUNING.rotationTiltX
      + Math.sin(elapsed * 0.24) * TUNING.rotationDriftX * 0.35
      + s.bass * 0.08 * Math.sin(elapsed * 1.0)
      + s.bassPeak * 0.05;
    this.rotationGroup.rotation.z = Math.sin(elapsed * 0.17 + 1.1) * TUNING.rotationDriftZ
      + s.treble * 0.06 * Math.sin(elapsed * 2.2)
      + s.treblePeak * 0.04 * Math.sin(elapsed * 5.5);
    // 内层粒子略差速，避免整体像刚性转盘
    this.points.rotation.y -= rotY * TUNING.rotationLayerDesync * dt;

    // 呼吸缩放
    const microBreath = 1 + Math.sin(elapsed * TUNING.breathRate) * TUNING.microBreathScale * (1 + s.level * 2.2 + s.bass * 1.6 + s.bassPeak * 0.9);
    const rhythmStretch = 1 + rhythm * TUNING.rhythmPulseGain * 0.08;
    const squashX = 1 + Math.sin(elapsed * 0.31 + 0.7) * 0.025 * rhythmStretch;
    const squashY = microBreath * (1 + rhythm * 0.06);
    const squashZ = 1 + Math.cos(elapsed * 0.27) * 0.022 * rhythmStretch;
    this.points.scale.set(squashX * microBreath, squashY, squashZ * microBreath);

    this._compositeMat.uniforms.u_bloomStrength.value = TUNING.bloomStrengthBase + s.level * 0.28 + s.transient * 0.14 + s.treblePeak * 0.12;
    this._extractMat.uniforms.u_threshold.value = TUNING.bloomThreshold - s.level * 0.05;

    if (TUNING.postBloom) this._renderWithBloom();
    else this.renderer.render(this.scene, this.camera);
  }

  _renderWithBloom() {
    const r = this.renderer;
    const prevAutoClear = r.autoClear;

    r.setRenderTarget(this._sceneRT);
    r.autoClear = true;
    r.clear();
    r.render(this.scene, this.camera);

    this._extractMat.uniforms.tDiffuse.value = this._sceneRT.texture;
    this._quadMesh.material = this._extractMat;
    r.setRenderTarget(this._bloomRT1);
    r.render(this._quadScene, this._quadCam);

    this._blur2dMat.uniforms.tDiffuse.value = this._bloomRT1.texture;
    this._quadMesh.material = this._blur2dMat;
    r.setRenderTarget(this._bloomRT2);
    r.render(this._quadScene, this._quadCam);

    this._compositeMat.uniforms.tScene.value = this._sceneRT.texture;
    this._compositeMat.uniforms.tBloom.value = this._bloomRT2.texture;
    this._quadMesh.material = this._compositeMat;
    r.setRenderTarget(null);
    r.autoClear = prevAutoClear;
    r.render(this._quadScene, this._quadCam);
  }

  // ----------------------------------------------------------- palette

  _defaultPaletteSlots() {
    const mk = (r, g, b) => new THREE.Color(r / 255, g / 255, b / 255);
    return [
      mk(140, 120, 180),
      mk(160, 140, 170),
      mk(120, 130, 200),
      mk(180, 150, 160),
      mk(100, 120, 180)
    ];
  }

  updatePalette(palette) {
    if (palette && palette.length) this._targetPalette = palette;
  }

  _syncPaletteFromSource() {
    if (!this.material) return;
    const palette = this._targetPalette || window.activeVisualParams?.palette;
    if (!palette?.length) return;

    const u = this.material.uniforms;
    const count = Math.min(5, palette.length);
    u.u_paletteCount.value = count;
    const lerpT = 0.16;

    for (let i = 0; i < 5; i += 1) {
      const c = palette[Math.min(i, palette.length - 1)];
      const slot = u[`u_palette${i}`].value;
      const tr = c.r / 255;
      const tg = c.g / 255;
      const tb = c.b / 255;
      slot.r += (tr - slot.r) * lerpT;
      slot.g += (tg - slot.g) * lerpT;
      slot.b += (tb - slot.b) * lerpT;
    }
  }

  // ------------------------------------------------------------- audio

  updateAudioState(state) {
    if (!state) return;
    this._externalAudio = {
      bass: this._clamp01(state.bass),
      lowMid: this._clamp01(state.lowMid != null ? state.lowMid : state.mid),
      mid: this._clamp01(state.mid),
      treble: this._clamp01(state.treble),
      bassPeak: this._clamp01(state.bassPeak != null ? state.bassPeak : state.bass),
      treblePeak: this._clamp01(state.treblePeak != null ? state.treblePeak : state.treble),
      level: this._clamp01(state.level != null ? state.level : state.volume),
      transient: this._clamp01(state.transient),
      flux: this._clamp01(state.flux)
    };
  }

  setShapeMorphOptions(options = {}) {
    if (typeof options.enableShapeMorph === "boolean") {
      this.enableShapeMorph = options.enableShapeMorph;
    }
    if (options.shapeMorphStrength != null) {
      this.shapeMorphStrength = this._clamp01(options.shapeMorphStrength);
    }
    if (this.shapeMorph.profile) {
      this.updateShapeProfile(this.shapeMorph.profile, this.shapeMorph.archetype, {
        enabled: this.enableShapeMorph,
        strength: this.shapeMorphStrength
      });
    } else {
      this.clearShapeProfile();
    }
  }

  applyAcousticViz(acoustic, options = {}) {
    const hasPayload = acoustic
      && (acoustic.waveform?.length || acoustic.spectrum?.length || acoustic.spectrogram?.length);
    if (!hasPayload || typeof AcousticBreathingDriver === "undefined") {
      this.acousticDriver = null;
      this._latestAcousticFrame = null;
      this._writeDirectAcousticUniforms(null);
      this.clearShapeProfile();
      return;
    }

    const playbackTimeProvider = options.playbackTimeProvider || (() => {
      const audio = window.App?.playbackAudio;
      return audio && Number.isFinite(audio.currentTime) ? audio.currentTime : null;
    });

    this.acousticDriver = new AcousticBreathingDriver(acoustic, {
      loop: options.loop ?? true,
      playbackTimeProvider
    });
    this._latestAcousticFrame = null;
    this._prevSpectrum = null;
    this._burstEnvelope = 0;
    if (acoustic.shapeProfile) {
      this.updateShapeProfile(acoustic.shapeProfile, window.activeNaturalArchetype, {
        enabled: options.enableShapeMorph ?? this.enableShapeMorph,
        strength: options.shapeMorphStrength ?? this.shapeMorphStrength
      });
    } else if (typeof options.enableShapeMorph === "boolean" || options.shapeMorphStrength != null) {
      this.setShapeMorphOptions(options);
    } else {
      this.clearShapeProfile();
    }
  }

  _pullDirectAcoustic(timeSeconds) {
    if (!this.acousticDriver) return null;
    const frame = this.acousticDriver.update(timeSeconds);
    this._writeDirectAcousticUniforms(frame);
    this._latestAcousticFrame = frame;
    return frame;
  }

  _mixAudioStates(directState, liveState, liveWeight = 0.62) {
    if (!directState) return liveState;
    if (!liveState) return directState;

    const mix = (a = 0, b = 0) => a + (b - a) * liveWeight;
    return {
      bass: mix(directState.bass, liveState.bass),
      lowMid: mix(directState.lowMid, liveState.lowMid),
      mid: mix(directState.mid, liveState.mid),
      treble: mix(directState.treble, liveState.treble),
      bassPeak: mix(directState.bassPeak ?? directState.bass, liveState.bassPeak ?? liveState.bass),
      treblePeak: mix(directState.treblePeak ?? directState.treble, liveState.treblePeak ?? liveState.treble),
      level: mix(directState.level, liveState.level),
      flux: mix(directState.flux, liveState.flux),
      transient: Math.max(directState.transient ?? 0, liveState.transient ?? 0)
    };
  }

  _writeDirectAcousticUniforms(frame) {
    const uniforms = this.material?.uniforms;
    if (!uniforms) return;

    if (!frame?.shaderState) {
      if (uniforms.u_waveEnvelope) uniforms.u_waveEnvelope.value = 0;
      if (uniforms.u_waveSlope) uniforms.u_waveSlope.value = 0;
      if (uniforms.u_spectrumBands) uniforms.u_spectrumBands.value.set(0.25, 0.25, 0.25, 0.25);
      if (uniforms.u_spectrogramBands) uniforms.u_spectrogramBands.value.set(0.25, 0.25, 0.25, 0.25);
      if (uniforms.u_spectralCentroid) uniforms.u_spectralCentroid.value = 0.5;
      if (uniforms.u_spectralSpread) uniforms.u_spectralSpread.value = 0.2;
      if (uniforms.u_spectralEntropy) uniforms.u_spectralEntropy.value = 0.3;
      return;
    }

    const shader = frame.shaderState;
    const safe = (v, fallback = 0) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : fallback;
    };
    const band4 = (values, fallback = 0.25) => {
      const arr = Array.isArray(values) ? values : [];
      return [0, 1, 2, 3].map((i) => this._clamp01(safe(arr[i], fallback)));
    };

    if (uniforms.u_waveEnvelope) uniforms.u_waveEnvelope.value = this._clamp01(safe(shader.waveEnvelope));
    if (uniforms.u_waveSlope) uniforms.u_waveSlope.value = Math.max(-1, Math.min(1, safe(shader.waveSlope)));
    if (uniforms.u_spectrumBands) uniforms.u_spectrumBands.value.set(...band4(shader.spectrumBands));
    if (uniforms.u_spectrogramBands) uniforms.u_spectrogramBands.value.set(...band4(shader.spectrogramBands));
    if (uniforms.u_spectralCentroid) uniforms.u_spectralCentroid.value = this._clamp01(safe(shader.spectralCentroid, 0.5));
    if (uniforms.u_spectralSpread) uniforms.u_spectralSpread.value = this._clamp01(safe(shader.spectralSpread, 0.2));
    if (uniforms.u_spectralEntropy) uniforms.u_spectralEntropy.value = this._clamp01(safe(shader.spectralEntropy, 0.3));
  }

  updateShapeProfile(profile, archetype, options = {}) {
    if (!profile || typeof profile !== "object") {
      this.clearShapeProfile();
      return;
    }

    const enabled = options.enabled ?? this.enableShapeMorph;
    const strength = this._clamp01(options.strength ?? this.shapeMorphStrength ?? 0.82);
    if (!enabled || strength <= 0) {
      this.clearShapeProfile();
      return;
    }

    this.enableShapeMorph = true;
    this.shapeMorphStrength = strength;
    const normalized = this._normalizeShapeProfile(profile, archetype);
    this.shapeMorph.enabled = true;
    this.shapeMorph.targetStrength = strength;
    this.shapeMorph.profile = normalized.profile;
    this.shapeMorph.archetype = normalized.archetype;
    this._writeShapeMorphUniforms(normalized.profile);

    if (typeof console !== "undefined" && console.table) {
      console.group("[Sound Breathing ShapeProfile]");
      console.log("naturalArchetype:", normalized.archetype || null);
      console.table(normalized.profile);
      console.groupEnd();
    }
  }

  clearShapeProfile() {
    this.shapeMorph.enabled = false;
    this.shapeMorph.targetStrength = 0;
    this.shapeMorph.profile = null;
    this.shapeMorph.archetype = null;
    this._writeShapeMorphUniforms(null);
  }

  _normalizeShapeProfile(shapeProfile, archetype) {
    const n = (key, fallback = 0) => {
      const value = Number(shapeProfile?.[key]);
      return this._clamp01(Number.isFinite(value) ? value : fallback);
    };
    const stretch = (key, fallback = 0.5) => {
      const value = Number(shapeProfile?.[key]);
      const safe = this._clamp01(Number.isFinite(value) ? value : fallback);
      return 0.68 + safe * 0.92;
    };
    const archetypeId = typeof archetype === "string"
      ? archetype
      : archetype?.id || archetype?.archetypeId || null;

    const profile = {
      plume: n("plume"),
      ribbon: n("ribbon"),
      ring: n("ring"),
      burst: n("burst"),
      cluster: n("cluster"),
      stretchX: stretch("stretchX"),
      stretchY: stretch("stretchY"),
      stretchZ: stretch("stretchZ"),
      taper: n("taper"),
      twist: n("twist"),
      branchiness: n("branchiness"),
      fragmentation: n("fragmentation"),
      roughness: n("roughness"),
      density: n("density", 0.5),
      seed: 0
    };

    const seed = Number(shapeProfile?.seed);
    profile.seed = Number.isFinite(seed) ? ((seed % 100000) + 100000) % 100000 / 100000 : 0;

    switch (archetypeId) {
      case "birds":
        profile.plume += 0.38;
        profile.branchiness += 0.18;
        profile.taper += 0.12;
        profile.stretchY += 0.16;
        break;
      case "water":
        profile.ring += 0.28;
        profile.ribbon += 0.22;
        profile.stretchX += 0.16;
        profile.stretchY -= 0.16;
        break;
      case "wind_leaves":
        profile.ribbon += 0.36;
        profile.fragmentation += 0.10;
        profile.stretchX += 0.12;
        profile.stretchZ += 0.10;
        break;
      case "natural_material_interaction":
      case "material_impact":
        profile.burst += 0.42;
        profile.fragmentation += 0.22;
        profile.stretchX += 0.10;
        profile.stretchY += 0.10;
        profile.stretchZ += 0.10;
        break;
      case "insects_amphibians":
        profile.cluster += 0.34;
        profile.ring += 0.18;
        profile.density += 0.14;
        break;
      default:
        break;
    }

    ["plume", "ribbon", "ring", "burst", "cluster", "taper", "twist", "branchiness", "fragmentation", "roughness", "density"].forEach((key) => {
      profile[key] = this._clamp01(profile[key]);
    });
    profile.stretchX = Math.max(0.48, Math.min(1.85, profile.stretchX));
    profile.stretchY = Math.max(0.42, Math.min(1.95, profile.stretchY));
    profile.stretchZ = Math.max(0.48, Math.min(1.75, profile.stretchZ));

    const mixKeys = ["plume", "ribbon", "ring", "burst", "cluster"];
    const mixTotal = mixKeys.reduce((sum, key) => sum + profile[key], 0);
    if (mixTotal > 1.85) {
      const scale = 1.85 / mixTotal;
      mixKeys.forEach((key) => { profile[key] *= scale; });
    }

    return { profile, archetype: archetypeId };
  }

  _writeShapeMorphUniforms(shapeProfile) {
    const uniforms = this.material?.uniforms;
    if (!uniforms) return;

    const enabled = this.enableShapeMorph && this.shapeMorph.targetStrength > 0 && shapeProfile;
    uniforms.u_enableShapeMorph.value = enabled ? 1 : 0;

    if (!enabled) {
      uniforms.u_shapeMorphStrength.value = 0;
      uniforms.u_plumeMix.value = 0;
      uniforms.u_ribbonMix.value = 0;
      uniforms.u_ringMix.value = 0;
      uniforms.u_burstMix.value = 0;
      uniforms.u_clusterMix.value = 0;
      uniforms.u_shapeStretch.value.set(1, 1, 1);
      uniforms.u_shapeTaper.value = 0;
      uniforms.u_shapeTwist.value = 0;
      uniforms.u_branchiness.value = 0;
      uniforms.u_fragmentation.value = 0;
      uniforms.u_shapeRoughness.value = 0;
      uniforms.u_shapeDensity.value = 0.5;
      uniforms.u_shapeSeed.value = 0;
      return;
    }

    uniforms.u_plumeMix.value = shapeProfile.plume;
    uniforms.u_ribbonMix.value = shapeProfile.ribbon;
    uniforms.u_ringMix.value = shapeProfile.ring;
    uniforms.u_burstMix.value = shapeProfile.burst;
    uniforms.u_clusterMix.value = shapeProfile.cluster;
    uniforms.u_shapeStretch.value.set(shapeProfile.stretchX, shapeProfile.stretchY, shapeProfile.stretchZ);
    uniforms.u_shapeTaper.value = shapeProfile.taper;
    uniforms.u_shapeTwist.value = shapeProfile.twist;
    uniforms.u_branchiness.value = shapeProfile.branchiness;
    uniforms.u_fragmentation.value = shapeProfile.fragmentation;
    uniforms.u_shapeRoughness.value = shapeProfile.roughness;
    uniforms.u_shapeDensity.value = shapeProfile.density;
    uniforms.u_shapeSeed.value = shapeProfile.seed;
  }

  _readLivePlayback() {
    if (!this.playbackAnalyzer) return null;

    const app = window.App;

    if (app?.playbackAnalyser && app?.playbackAudio && !app.playbackAudio.paused) {
      if (app.playbackAnalyser !== this._lastAttachedAnalyser) {
        this.playbackAnalyzer.attachAnalyserNode(app.playbackAnalyser, app.playbackAudioCtx);
        this._lastAttachedAnalyser = app.playbackAnalyser;
      }
      app._resumePlaybackAudioCtx?.();
      const live = this.playbackAnalyzer.readFeatures();
      if (live) return live;
    }

    const tv = app?.transformView;
    if (tv?.waveAnalyser && tv.waveAudioCtx) {
      if (tv.waveAnalyser !== this._lastAttachedAnalyser) {
        this.playbackAnalyzer.attachAnalyserNode(tv.waveAnalyser, tv.waveAudioCtx);
        this._lastAttachedAnalyser = tv.waveAnalyser;
      }
      if (tv.waveAudioCtx.state === "running") {
        const live = this.playbackAnalyzer.readFeatures();
        if (live) return live;
      }
    }

    return null;
  }

  _pullAudio(time, dt) {
    let bass = 0;
    let lowMid = 0;
    let mid = 0;
    let treble = 0;
    let bassPeak = 0;
    let treblePeak = 0;
    let level = 0;
    let transient = 0;
    let flux = 0;
    let hasInput = false;
    let hasLivePlayback = false;

    const directFrame = this._pullDirectAcoustic(time);
    const directState = directFrame?.audioState || null;
    const livePlayback = this._readLivePlayback();
    if (livePlayback) {
      const combined = this._mixAudioStates(directState, livePlayback, 0.62);
      ({
        bass, lowMid, mid, treble, level, flux, transient,
        bassPeak = bass, treblePeak = treble
      } = combined);
      hasInput = true;
      hasLivePlayback = true;
    } else if (directState) {
      ({
        bass, lowMid, mid, treble, level, flux, transient,
        bassPeak = bass, treblePeak = treble
      } = directState);
      hasInput = true;
    }

    if (this._externalAudio && !hasLivePlayback && !directState) {
      bass = this._externalAudio.bass ?? 0;
      mid = this._externalAudio.mid ?? 0;
      treble = this._externalAudio.treble ?? 0;
      level = this._externalAudio.level ?? 0;
      bassPeak = this._externalAudio.bassPeak ?? bass;
      treblePeak = this._externalAudio.treblePeak ?? treble;
      lowMid = this._externalAudio.lowMid ?? mid * 0.85;
      transient = this._externalAudio.transient ?? 0;
      flux = this._externalAudio.flux ?? 0;
      hasInput = bass + mid + treble + level > 0.02;
    }

    const esp32 = window.esp32AudioAdapter;
    if (esp32 && esp32.isConnected && esp32.isConnected()) {
      const live = esp32.getVisualFeatures();
      const espState = {
        bass: live.low ?? 0,
        lowMid: live.mid ?? 0,
        mid: live.mid ?? 0,
        treble: live.high ?? 0,
        bassPeak: live.low ?? 0,
        treblePeak: live.high ?? 0,
        level: live.volume ?? 0,
        flux,
        transient
      };
      const mixed = this._mixAudioStates({ bass, lowMid, mid, treble, bassPeak, treblePeak, level, flux, transient }, espState, directState ? 0.35 : 0.55);
      ({ bass, lowMid, mid, treble, bassPeak, treblePeak, level, flux, transient } = mixed);
      hasInput = true;
    }

    const analysed = window.activeAudioFeatures;
    if (analysed && !hasLivePlayback && !directState) {
      const py = window.pythonEnhancedFeatures;
      const f = py ? FeatureSchema.mergeFeatures(analysed, py, 0.35) : analysed;
      const pulse = 0.55 + 0.45 * Math.abs(Math.sin(time * 2.8 + (f.pitch ?? 0) * 4));
      const flow = 0.6 + 0.4 * Math.sin(time * 4.2);
      bass = this._clamp01((f.bass ?? 0.15) * pulse);
      lowMid = this._clamp01((f.mid ?? 0.12) * flow * 0.9);
      mid = this._clamp01((f.mid ?? 0.12) * flow);
      treble = this._clamp01((f.treble ?? 0.1) * (0.5 + 0.5 * Math.sin(time * 7.5)));
      level = this._clamp01((f.volume ?? 0.2) * pulse);
      flux = this._clamp01((f.spectralVariation ?? f.roughness ?? 0.12) * pulse);
      hasInput = true;
    }

    if (!hasInput) {
      bass = 0.14 + Math.sin(time * 0.9) * 0.08;
      lowMid = 0.12 + Math.sin(time * 0.7 + 0.8) * 0.06;
      mid = 0.12 + Math.sin(time * 0.6 + 1.3) * 0.06;
      treble = 0.1 + Math.sin(time * 1.4 + 2.1) * 0.05;
      level = 0.12 + Math.sin(time * 0.75) * 0.06;
      flux = 0.08 + Math.abs(Math.sin(time * 1.6)) * 0.06;
    }

    const levelJump = Math.max(0, level - this._prevLevel);
    const onset = levelJump * 4.5 + flux * 0.8;
    this._burstEnvelope = Math.max(onset, this._burstEnvelope * TUNING.transientDecay);
    transient = Math.max(transient, this._burstEnvelope);
    this._prevLevel = level;

    bass = this._clamp01(bass);
    lowMid = this._clamp01(lowMid);
    mid = this._clamp01(mid);
    treble = this._clamp01(treble);
    bassPeak = this._clamp01(bassPeak);
    treblePeak = this._clamp01(treblePeak);
    level = this._clamp01(level);
    transient = this._clamp01(transient);
    flux = this._clamp01(flux);

    if (hasLivePlayback) {
      this._smoothAudioBand("bass", bass, TUNING.audioAttackBass, TUNING.audioReleaseBass, dt);
      this._smoothAudioBand("treble", treble, TUNING.audioAttackTreble, TUNING.audioReleaseTreble, dt);
      this._smoothAudioBand("bassPeak", bassPeak, 0.72, 0.14, dt);
      this._smoothAudioBand("treblePeak", treblePeak, 0.78, 0.16, dt);
      const lerpT = TUNING.audioLerp;
      this.smoothed.lowMid = this._lerp(this.smoothed.lowMid, lowMid, lerpT);
      this.smoothed.mid = this._lerp(this.smoothed.mid, mid, lerpT);
      this.smoothed.level = this._lerp(this.smoothed.level, level, lerpT);
      this.smoothed.transient = this._lerp(this.smoothed.transient, transient, 0.32);
      this.smoothed.flux = this._lerp(this.smoothed.flux, flux, lerpT);
    } else {
      const lerpT = 0.1 + dt * 2;
      this.smoothed.bass = this._lerp(this.smoothed.bass, bass, lerpT);
      this.smoothed.lowMid = this._lerp(this.smoothed.lowMid, lowMid, lerpT);
      this.smoothed.mid = this._lerp(this.smoothed.mid, mid, lerpT);
      this.smoothed.treble = this._lerp(this.smoothed.treble, treble, lerpT);
      this.smoothed.bassPeak = this._lerp(this.smoothed.bassPeak, bassPeak, lerpT);
      this.smoothed.treblePeak = this._lerp(this.smoothed.treblePeak, treblePeak, lerpT);
      this.smoothed.level = this._lerp(this.smoothed.level, level, lerpT);
      this.smoothed.transient = this._lerp(this.smoothed.transient, transient, 0.18);
      this.smoothed.flux = this._lerp(this.smoothed.flux, flux, lerpT);
    }
  }

  _smoothAudioBand(key, target, attack, release, dt) {
    const cur = this.smoothed[key] || 0;
    const rate = target > cur ? attack : release;
    this.smoothed[key] = cur + (target - cur) * Math.min(1, rate * dt * 60);
  }

  _spectralFlux(spec) {
    if (!this._prevSpectrum || this._prevSpectrum.length !== spec.length) {
      this._prevSpectrum = spec.slice();
      return 0;
    }
    let fluxSum = 0;
    for (let i = 4; i < spec.length; i += 4) {
      const diff = (spec[i] - this._prevSpectrum[i]) / 255;
      fluxSum += diff > 0 ? diff : 0;
    }
    this._prevSpectrum = spec.slice();
    return this._clamp01((fluxSum / (spec.length / 4)) * TUNING.fluxSensitivity);
  }

  _setupP5Audio() {
    return { esp32Only: true };
  }

  _band(spec, from, to) {
    const start = Math.floor(spec.length * from);
    const end = Math.max(start + 1, Math.floor(spec.length * to));
    let sum = 0;
    for (let i = start; i < end; i += 1) sum += spec[i] / 255;
    return this._clamp01(sum / (end - start));
  }

  // ------------------------------------------------------- housekeeping

  _seededRandom(seed) {
    let s = seed % 2147483647;
    if (s <= 0) s += 2147483646;
    return () => {
      s = (s * 16807) % 2147483647;
      return (s - 1) / 2147483646;
    };
  }

  _lerp(a, b, t) { return a + (b - a) * t; }
  _clamp01(v) { return Math.min(1, Math.max(0, v || 0)); }

  // Back-compat shim for older callers (no-op for rendering; loop is internal).
  clear() {
    this.clock = new THREE.Clock();
    this.smoothed = {
      bass: 0.1, lowMid: 0.09, mid: 0.1, treble: 0.08,
      bassPeak: 0, treblePeak: 0,
      level: 0.1, transient: 0, flux: 0
    };
    this._burstEnvelope = 0;
    this._prevLevel = 0.1;
    this._prevSpectrum = null;
    this._latestAcousticFrame = null;
    this._writeDirectAcousticUniforms(null);
    this.clearShapeProfile();
    this._spinAngle = 0;
    if (this.rotationGroup) {
      this.rotationGroup.rotation.y = 0;
      this.rotationGroup.rotation.x = TUNING.rotationTiltX;
      this.rotationGroup.rotation.z = 0;
    }
    if (this.points) this.points.rotation.y = 0;
  }

  dispose() {
    this.running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    if (this.geometry) this.geometry.dispose();
    if (this.material) this.material.dispose();
    [this._sceneRT, this._bloomRT1, this._bloomRT2].forEach((rt) => rt && rt.dispose());
    [this._extractMat, this._blur2dMat, this._compositeMat].forEach((m) => m && m.dispose());
    if (this.renderer) this.renderer.dispose();
    if (this.canvas && this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas);
    this.ready = false;
  }
}

// ====================================================================
// Shaders
// ====================================================================

const MEMBRANE_VERT = `
attribute vec3 aNormal;
attribute float aSeed;
attribute float aLayer;
attribute float aShellFactor;
attribute float aIntensity;
attribute float aLocalPhase;
attribute float aRegion;
attribute float aColorT;

uniform float u_time;
uniform float u_bass;
uniform float u_lowMid;
uniform float u_mid;
uniform float u_treble;
uniform float u_level;
uniform float u_transient;
uniform float u_flux;
uniform float u_noiseAmp;
uniform float u_flowSpeed;
uniform float u_breathAmp;
uniform float u_localBurstStrength;
uniform float u_rotationDrift;
uniform float u_shuttleSpeed;
uniform float u_shuttleBreakout;
uniform float u_shapeLump;
uniform float u_rhythmPulse;
uniform float u_particleSize;
uniform float u_pixelRatio;
uniform float u_waveEnvelope;
uniform float u_waveSlope;
uniform vec4 u_spectrumBands;
uniform vec4 u_spectrogramBands;
uniform float u_spectralCentroid;
uniform float u_spectralSpread;
uniform float u_spectralEntropy;
uniform float u_enableShapeMorph;
uniform float u_shapeMorphStrength;
uniform float u_plumeMix;
uniform float u_ribbonMix;
uniform float u_ringMix;
uniform float u_burstMix;
uniform float u_clusterMix;
uniform vec3 u_shapeStretch;
uniform float u_shapeTaper;
uniform float u_shapeTwist;
uniform float u_branchiness;
uniform float u_fragmentation;
uniform float u_shapeRoughness;
uniform float u_shapeDensity;
uniform float u_shapeSeed;

varying float vShellFactor;
varying float vLayer;
varying float vIntensity;
varying float vRim;
varying float vShimmer;
varying float vBurst;
varying float vLocalBright;
varying float vShuttle;
varying float vColorT;

vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
    i.z + vec4(0.0, i1.z, i2.z, 1.0))
    + i.y + vec4(0.0, i1.y, i2.y, 1.0))
    + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}

float fbm(vec3 p) {
  float v = 0.0;
  float a = 0.5;
  vec3 shift = vec3(100.0, 0.0, 0.0);
  for (int i = 0; i < FBM_OCTAVES; i++) {
    v += a * snoise(p);
    p = p * 2.02 + shift;
    a *= 0.5;
  }
  return v;
}

void main() {
  vec3 pos = position;
  vec3 n = normalize(aNormal);
  bool isShuttle = aLayer > 2.5;

  if (isShuttle) {
    vec3 dir = normalize(pos);
    bool crossCore = aLayer > 3.5;
    float spd = u_shuttleSpeed * (0.65 + fract(aSeed * 0.017) * 0.7);
    float shuttlePhase = u_time * spd + aLocalPhase;
    float sw = sin(shuttlePhase);
    float sw2 = cos(shuttlePhase * 1.43 + aRegion * 6.283);

    float innerR;
    float outerR;
    if (crossCore) {
      // 穿越圆心：外 → 心 → 外，打破中空对称
      innerR = 0.04 + aRegion * 0.14;
      outerR = 0.94 + aRegion * 0.32;
    } else {
      innerR = 0.48 + aRegion * 0.14;
      outerR = 0.96 + aRegion * 0.26;
    }

    float t = sw * 0.5 + 0.5;
    t = t * t * (3.0 - 2.0 * t);
    float r = mix(innerR, outerR, t);
    r += max(0.0, sw2) * u_shuttleBreakout * (crossCore ? 1.15 : 0.85);
    r += u_rhythmPulse * 0.06 * sin(shuttlePhase * 2.0 + aRegion * 9.0);

    pos = dir * r;

    vec3 axisW = normalize(vec3(sin(aRegion * 11.0), 0.32 + cos(aRegion * 7.0) * 0.2, cos(aRegion * 13.0)));
    vec3 wTan = normalize(cross(dir, axisW) + vec3(0.0001));
    vec3 wBi = normalize(cross(dir, wTan));
    float weave = crossCore ? 0.11 : 0.07;
    pos += wTan * sw2 * weave * (1.0 + u_mid * 0.55 + u_rhythmPulse * 0.4);
    pos += wBi * sw * (weave * 0.65) * (1.0 + u_treble * 0.35);
    pos += dir * snoise(dir * 5.0 + vec3(u_time * 1.8, aSeed, 0.0)) * u_treble * 0.02;

    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    float dist = max(0.1, -mvPosition.z);
    float trail = 0.5 + 0.5 * (1.0 - abs(sw));
    float coreBright = crossCore ? (0.75 + 0.25 * (1.0 - r / 1.1)) : 1.0;
    gl_PointSize = clamp(u_particleSize * u_pixelRatio * (112.0 / dist) * trail * coreBright * 0.9, 0.58, 3.8);

    vec3 viewDir = normalize(-mvPosition.xyz);
    vec3 nView = normalize((modelViewMatrix * vec4(dir, 0.0)).xyz);
    vRim = pow(1.0 - abs(dot(nView, viewDir)), 1.4);
    vShellFactor = r / 1.28;
    vLayer = aLayer;
    vIntensity = aIntensity * (crossCore ? 0.95 : 0.85);
    vShimmer = sin(aSeed * 10.0 + u_time * (4.0 + u_treble * 8.0)) * 0.5 + 0.5;
    vBurst = u_rhythmPulse * 0.35;
    vLocalBright = trail * (crossCore ? 0.75 : 0.6);
    vShuttle = trail;
    vColorT = clamp(aColorT + r * 0.12, 0.0, 1.0);
    return;
  }

  float layerFreq = 1.0 + aLayer * 0.5;
  float layerSpeed = (aLayer < 0.5) ? 0.35 : (aLayer < 1.5 ? 1.0 : 1.35);
  float layerPhase = aLocalPhase + aLayer * 1.7;
  float flowT = u_time * u_flowSpeed * layerSpeed + layerPhase * 0.15;

  if (u_enableShapeMorph > 0.5 && u_shapeMorphStrength > 0.001) {
    vec3 originalShapePos = position;
    vec3 originalDir = normalize(originalShapePos);
    vec3 shapeTangent = normalize(cross(originalDir, vec3(0.0, 1.0, 0.0)) + vec3(0.0001));
    vec3 shapeBitangent = normalize(cross(originalDir, shapeTangent));
    float theta = atan(originalDir.z, originalDir.x);
    float y01 = clamp(originalDir.y * 0.5 + 0.5, 0.0, 1.0);
    float seedPhase = u_shapeSeed * 6.28318;
    float roughNoise = snoise(originalDir * (2.0 + u_shapeRoughness * 7.0) + vec3(seedPhase, aSeed * 0.017, aRegion * 4.0));
    float fragmentGate = step(0.28 + u_fragmentation * 0.24, fract(aSeed * 0.137 + u_shapeSeed * 3.1));

    float plumeRise = pow(y01, 1.15);
    float plumeRadius = (0.20 + (1.0 - plumeRise) * 0.78) * (1.0 - u_shapeTaper * plumeRise * 0.62);
    float branchWave = sin(theta * (3.0 + u_branchiness * 9.0) + plumeRise * 9.0 + seedPhase);
    vec3 plumePos = vec3(
      originalDir.x * plumeRadius + shapeTangent.x * branchWave * u_branchiness * plumeRise * 0.34,
      mix(-0.58, 1.72, plumeRise) + roughNoise * u_branchiness * 0.18,
      originalDir.z * plumeRadius + shapeTangent.z * branchWave * u_branchiness * plumeRise * 0.34
    );
    plumePos.xz *= 0.78 + u_shapeDensity * 0.28;

    float ribbonWave = sin(theta * (1.2 + u_shapeTwist * 3.7) + originalDir.y * 5.0 + seedPhase + u_time * 0.32);
    vec3 ribbonPos = vec3(
      originalDir.x * (1.18 + u_shapeStretch.x * 0.34),
      originalDir.y * (0.16 + 0.22 * (1.0 - u_ribbonMix)) + ribbonWave * (0.10 + u_shapeTwist * 0.26),
      originalDir.z * (0.44 + u_shapeStretch.z * 0.28) + shapeBitangent.z * roughNoise * (0.10 + u_fragmentation * 0.20)
    );
    ribbonPos += shapeTangent * roughNoise * u_shapeRoughness * 0.15;

    float ringRadius = 0.68 + 0.22 * sin(originalDir.y * (7.0 + u_shapeDensity * 10.0) + seedPhase + u_time * 0.18);
    vec3 ringPos = vec3(
      cos(theta + u_shapeTwist * originalDir.y * 2.2) * ringRadius,
      originalDir.y * (0.10 + u_clusterMix * 0.20) + sin(theta * (2.0 + u_shapeDensity * 6.0) + seedPhase) * 0.07,
      sin(theta + u_shapeTwist * originalDir.y * 2.2) * ringRadius
    );

    vec3 burstDir = normalize(originalDir + shapeTangent * roughNoise * u_fragmentation * 0.75 + shapeBitangent * sin(aSeed + seedPhase) * u_fragmentation * 0.34);
    vec3 burstPos = burstDir * (0.72 + u_burstMix * 0.96 + fragmentGate * u_fragmentation * 0.52 + max(0.0, roughNoise) * 0.22);
    burstPos += shapeTangent * fragmentGate * u_fragmentation * (0.10 + aRegion * 0.16);

    float cells = 5.0 + floor(u_shapeDensity * 10.0 + u_clusterMix * 5.0);
    float cellTheta = floor((theta + 3.14159) / (6.28318 / cells)) * (6.28318 / cells) - 3.14159;
    float cellY = floor((originalDir.y + 1.0) * (2.0 + u_shapeDensity * 5.0)) / (2.0 + u_shapeDensity * 5.0) - 0.5;
    vec3 clusterCenter = normalize(vec3(cos(cellTheta), cellY * 0.86, sin(cellTheta)));
    float clusterPulse = sin(u_time * (0.65 + u_clusterMix * 1.9) + aRegion * 9.0) * 0.5 + 0.5;
    vec3 clusterPos = clusterCenter * (0.58 + aShellFactor * 0.46 + clusterPulse * u_clusterMix * 0.10) +
      (originalDir - clusterCenter) * (0.16 + (1.0 - u_clusterMix) * 0.34);

    vec3 shapeOffset = vec3(0.0);
    float shapeWeight = 0.0;
    shapeOffset += (plumePos - originalShapePos) * u_plumeMix;
    shapeWeight += u_plumeMix;
    shapeOffset += (ribbonPos - originalShapePos) * u_ribbonMix;
    shapeWeight += u_ribbonMix;
    shapeOffset += (ringPos - originalShapePos) * u_ringMix;
    shapeWeight += u_ringMix;
    shapeOffset += (burstPos - originalShapePos) * u_burstMix;
    shapeWeight += u_burstMix;
    shapeOffset += (clusterPos - originalShapePos) * u_clusterMix;
    shapeWeight += u_clusterMix;

    if (shapeWeight > 0.0001) {
      shapeOffset /= max(1.0, shapeWeight);
    }

    vec3 morphedShapePos = (originalShapePos + shapeOffset) * u_shapeStretch;
    pos = mix(originalShapePos, morphedShapePos, clamp(u_shapeMorphStrength * (0.64 + aShellFactor * 0.36), 0.0, 1.0));
  }

  float breathPhase = u_time * 0.52 + layerPhase + aLayer * 0.9;
  float breathLayer = sin(breathPhase);
  float breathWeight = (aLayer < 0.5) ? 0.25 : (aLayer < 1.5 ? 1.0 : 0.55);
  float breathDelay = (aLayer > 1.5) ? 0.35 : 0.0;
  breathLayer = sin(breathPhase - breathDelay);
  float breath = breathLayer * u_breathAmp * breathWeight * (0.55 + aShellFactor * 0.55);
  float breathPatch = snoise(n * 2.6 + vec3(aRegion * 4.5, u_time * 0.08, 0.0));
  pos *= 1.0 + breath * (0.55 + 0.45 * breathPatch);

  // 区域性凹凸：部分凸起、部分凹陷，随节奏脉动
  float lumpField = fbm(n * 1.25 + vec3(aRegion * 3.2, u_time * 0.11, aSeed * 0.01));
  float lumpSign = snoise(n * 2.4 + vec3(u_time * 0.16, aRegion * 7.0, aSeed));
  float lumpMask = smoothstep(-0.15, 0.7, lumpField);
  float rhythmDrive = u_rhythmPulse * 1.15 + u_bass * 0.55 + u_transient * 0.65;
  float layerLump = (aLayer < 0.5) ? 0.35 : (aLayer < 1.5 ? 1.0 : 0.62);
  float signedBump = lumpSign * lumpMask * u_shapeLump * rhythmDrive * layerLump;
  pos += n * signedBump * (0.22 + aShellFactor * 0.42);

  // 低频：主壳径向脉冲；高频：细颗粒抖动
  if (aLayer > 0.4 && aLayer < 1.6) {
    pos += n * u_bass * 0.085 * (0.45 + aShellFactor * 0.55);
  }
  if (aLayer < 0.6) {
    pos += n * u_bass * 0.035 * (1.0 - aShellFactor);
  }

  float flowMask = 0.45 + 0.55 * snoise(n * 2.2 + vec3(aRegion * 3.0, 0.0, 0.0));
  float nLarge = fbm(pos * layerFreq + vec3(flowT * 0.45, flowT * 0.3, aSeed));
  float nMed = (aLayer < 0.5)
    ? nLarge * 0.62
    : fbm(pos * (2.5 * layerFreq) + vec3(0.0, flowT * 0.75, aSeed * 0.5));
  float nFine = (aLayer > 1.5)
    ? snoise(pos * (4.2 * layerFreq) + vec3(flowT * 1.0, aSeed, u_time * 0.5)) * 0.7
    : snoise(pos * (5.2 * layerFreq) + vec3(flowT * 1.0, aSeed, u_time * 0.5));
  float disp = (nLarge * 0.48 + nMed * 0.34 + nFine * 0.18) * flowMask;
  disp = disp * 1.35 - 0.28;

  float amp = u_noiseAmp * (0.6 + u_bass * 2.4 + u_rhythmPulse * 0.55);
  float layerAmp = (aLayer < 0.5) ? 0.28 : (aLayer < 1.5 ? 1.0 : 0.72);
  pos += n * disp * amp * layerAmp * (0.14 + aShellFactor * 0.18);

  vec3 tangent = normalize(cross(n, vec3(0.0, 1.0, 0.0)) + vec3(0.0001));
  vec3 bitangent = normalize(cross(n, tangent));

  float slide = snoise(pos * 1.6 + vec3(0.0, flowT * 1.1, aSeed));
  pos += tangent * slide * (u_mid * 0.08 + u_lowMid * 0.05) * flowMask;

  // Direct acoustic morphology:
  // waveform = global breathing; whole-clip spectrum = persistent identity;
  // spectrogram = time-varying local texture.
  pos *= 1.0 + u_waveEnvelope * 0.085;
  pos += tangent * u_waveSlope * 0.028;

  float acousticJit = snoise(pos * 10.5 + vec3(u_time * 0.58, aSeed, aRegion * 2.0));
  float baseLow = sin(pos.y * 2.6 + u_time * 0.18) * u_spectrumBands.x * 0.050;
  float baseMid = sin((pos.x + pos.z) * 7.5 + layerPhase + u_time * 0.36) *
    (u_spectrumBands.y + u_spectrumBands.z) * 0.026;
  float baseHigh = sin(pos.y * 19.0 + pos.x * 11.0 + layerPhase) *
    u_spectrumBands.w * 0.020;
  pos += n * (baseLow + baseMid + baseHigh) * (0.55 + u_spectralSpread * 0.75);

  float temporalLow = sin(pos.y * 3.0 - u_time * 0.42) * u_spectrogramBands.x * 0.045;
  float temporalMid = sin((pos.x - pos.z) * 9.0 + u_time * 0.78) *
    (u_spectrogramBands.y + u_spectrogramBands.z) * 0.022;
  float temporalHigh = acousticJit * u_spectrogramBands.w * 0.070 *
    (0.35 + u_spectralEntropy * 0.95);
  pos += n * (temporalLow + temporalMid + temporalHigh);
  pos += n * acousticJit * mix(0.006, 0.050, u_spectralCentroid);

  float jit = snoise(pos * 11.0 + vec3(u_time * (1.2 + u_treble * 9.0), aSeed, 0.0));
  pos += n * jit * u_treble * 0.078 * (aLayer > 0.5 ? 1.0 : 0.45);
  pos += tangent * u_treble * 0.035 * sin(u_time * (3.5 + u_treble * 6.0) + aLocalPhase);

  float regionCluster = snoise(vec3(aRegion * 8.0, n.x * 2.0, n.y * 2.0));
  float localMask = smoothstep(0.15, 0.75, regionCluster + u_transient * 1.2 - 0.2);
  localMask *= smoothstep(0.2, 0.8, snoise(n * 3.5 + vec3(u_time * 0.3, aRegion * 5.0, 0.0)) + u_flux * 0.8);
  float burstDisp = u_localBurstStrength * localMask * (u_transient * 2.0 + u_flux * 1.2 + u_rhythmPulse * 1.4);
  burstDisp *= (aLayer < 1.5) ? 1.0 : 1.5;
  pos += n * burstDisp * (0.14 + aShellFactor * 0.16);
  pos += tangent * signedBump * 0.18 * u_rhythmPulse;

  float angDrift = sin(u_time * 0.22 * layerSpeed + aLocalPhase) * 0.022 * layerSpeed;
  float ca = cos(angDrift);
  float sa = sin(angDrift);
  pos.xz = mat2(ca, -sa, sa, ca) * pos.xz;

  vec3 spinAxis = normalize(vec3(0.12, 1.0, 0.06));
  vec3 spinTan = normalize(cross(n, spinAxis) + vec3(0.0001));
  float spinPhase = u_time * (0.35 + layerSpeed * 0.15) + aLocalPhase + aLayer * 0.8;
  float spinWave = sin(spinPhase) * u_rotationDrift;
  pos += spinTan * spinWave * aShellFactor * (0.035 + aLayer * 0.012);

  vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mvPosition;

  float dist = max(0.1, -mvPosition.z);
  float sizeBase = u_particleSize;
  if (aLayer < 0.5) sizeBase *= 0.58;
  else if (aLayer > 1.5) sizeBase *= 0.72;
  sizeBase *= 0.68 + aShellFactor * 0.48;
  sizeBase *= 1.0 + localMask * u_transient * 0.35;
  gl_PointSize = clamp(sizeBase * u_pixelRatio * (122.0 / dist), 0.72, 4.0);

  vec3 viewDir = normalize(-mvPosition.xyz);
  vec3 nView = normalize((modelViewMatrix * vec4(n, 0.0)).xyz);
  vRim = pow(1.0 - abs(dot(nView, viewDir)), 1.6);

  vShellFactor = aShellFactor;
  vLayer = aLayer;
  vIntensity = aIntensity;
  vShimmer = sin(aSeed * 8.0 + u_time * (3.0 + u_treble * 6.0)) * 0.5 + 0.5;
  vBurst = localMask * (u_transient + u_flux * 0.5);
  vLocalBright = localMask;
  vShuttle = 0.0;
  vColorT = clamp(aColorT + aShellFactor * 0.14, 0.0, 1.0);
}
`;

const MEMBRANE_FRAG = `
uniform vec3 u_palette0;
uniform vec3 u_palette1;
uniform vec3 u_palette2;
uniform vec3 u_palette3;
uniform vec3 u_palette4;
uniform float u_paletteCount;
uniform float u_level;
uniform float u_bass;
uniform float u_treble;
uniform float u_transient;
uniform float u_brightness;
uniform float u_alphaGain;

varying float vShellFactor;
varying float vLayer;
varying float vIntensity;
varying float vRim;
varying float vShimmer;
varying float vBurst;
varying float vLocalBright;
varying float vShuttle;
varying float vColorT;

vec3 samplePalette(float t) {
  t = clamp(t, 0.0, 1.0);
  float n = u_paletteCount;
  if (n < 1.5) return u_palette0;
  if (n < 2.5) return mix(u_palette0, u_palette1, t);
  if (n < 3.5) {
    if (t < 0.5) return mix(u_palette0, u_palette1, t * 2.0);
    return mix(u_palette1, u_palette2, (t - 0.5) * 2.0);
  }
  if (n < 4.5) {
    if (t < 0.333) return mix(u_palette0, u_palette1, t * 3.0);
    if (t < 0.666) return mix(u_palette1, u_palette2, (t - 0.333) * 3.0);
    return mix(u_palette2, u_palette3, (t - 0.666) * 3.0);
  }
  if (t < 0.25) return mix(u_palette0, u_palette1, t * 4.0);
  if (t < 0.5) return mix(u_palette1, u_palette2, (t - 0.25) * 4.0);
  if (t < 0.75) return mix(u_palette2, u_palette3, (t - 0.5) * 4.0);
  return mix(u_palette3, u_palette4, (t - 0.75) * 4.0);
}

void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv);
  if (d > 0.5) discard;

  float grain = 1.0 - smoothstep(0.16, 0.46, d);
  grain = pow(grain, 2.1);
  float core = 1.0 - smoothstep(0.0, 0.14, d);
  grain = max(grain, core * 0.92);

  bool isShuttle = vLayer > 2.5;
  bool crossCore = vLayer > 3.5;
  float shell = isShuttle
    ? smoothstep(0.32, 1.05, vShellFactor)
    : smoothstep(0.38, 1.0, vShellFactor);
  shell = pow(shell, isShuttle ? 1.35 : 1.75);

  float layerAlpha;
  if (isShuttle) {
    layerAlpha = crossCore ? (0.32 + vShuttle * 0.34) : (0.28 + vShuttle * 0.28);
  } else if (vLayer < 0.5) {
    layerAlpha = 0.16;
  } else if (vLayer < 1.5) {
    layerAlpha = 0.54;
  } else {
    layerAlpha = 0.24;
  }

  float rim = 0.48 + vRim * (isShuttle ? 1.25 : 0.95);

  float alpha = grain * layerAlpha * shell * vIntensity * rim * u_alphaGain;
  alpha *= 0.72 + u_level * 0.52;
  alpha *= 0.9 + vShimmer * u_treble * (isShuttle ? 0.38 : 0.26);
  alpha *= 1.0 + vBurst * 0.5;
  alpha *= 1.0 + u_bass * 0.14 * shell;
  if (isShuttle) {
    alpha *= 0.88 + vShuttle * 0.42;
  }

  float bright = (0.68 + shell * 0.72 + vRim * 0.48) * u_brightness;
  bright *= 1.0 + vBurst * 0.7 + vLocalBright * u_transient * 0.45;
  if (isShuttle) {
    bright *= 1.1 + vShimmer * 0.32 + vShuttle * 0.22 + vBurst * 0.4;
    if (crossCore) bright *= 1.0 + vLocalBright * 0.4;
  }
  vec3 baseCol = samplePalette(vColorT);
  vec3 col = baseCol * bright;
  col *= 0.94 + vShimmer * u_treble * (isShuttle ? 0.28 : 0.2);
  col = max(col, baseCol * 0.35);
  alpha = min(alpha, 0.92);

  gl_FragColor = vec4(col, alpha);
}
`;

const BLOOM_VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const BLOOM_EXTRACT_FRAG = `
uniform sampler2D tDiffuse;
uniform float u_threshold;
uniform float u_strength;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(tDiffuse, vUv);
  float lum = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
  float bright = max(lum - u_threshold, 0.0);
  gl_FragColor = vec4(c.rgb * bright * u_strength, 1.0);
}
`;

const BLOOM_BLUR2D_FRAG = `
uniform sampler2D tDiffuse;
uniform vec2 u_resolution;
varying vec2 vUv;
void main() {
  vec2 texel = 1.0 / u_resolution;
  vec4 sum = texture2D(tDiffuse, vUv) * 0.20;
  sum += texture2D(tDiffuse, vUv + vec2(texel.x, 0.0)) * 0.15;
  sum += texture2D(tDiffuse, vUv - vec2(texel.x, 0.0)) * 0.15;
  sum += texture2D(tDiffuse, vUv + vec2(0.0, texel.y)) * 0.15;
  sum += texture2D(tDiffuse, vUv - vec2(0.0, texel.y)) * 0.15;
  sum += texture2D(tDiffuse, vUv + texel) * 0.05;
  sum += texture2D(tDiffuse, vUv - texel) * 0.05;
  sum += texture2D(tDiffuse, vUv + vec2(texel.x, -texel.y)) * 0.05;
  sum += texture2D(tDiffuse, vUv + vec2(-texel.x, texel.y)) * 0.05;
  gl_FragColor = sum;
}
`;

const BLOOM_COMPOSITE_FRAG = `
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform float u_bloomStrength;
varying vec2 vUv;
void main() {
  vec4 scene = texture2D(tScene, vUv);
  vec4 bloom = texture2D(tBloom, vUv);
  vec3 col = scene.rgb + bloom.rgb * u_bloomStrength;
  gl_FragColor = vec4(col, 1.0);
}
`;

window.SoundMembraneSphere = SoundMembraneSphere;
window.MembraneSphere = SoundMembraneSphere;
window.MembraneTuning = TUNING;
