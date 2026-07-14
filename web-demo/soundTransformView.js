// Transparent sound → visual transformation pipeline UI.
// Runs before the main Visual Generation Area (analysis view).
class SoundTransformView {
  constructor(app) {
    this.app = app;
    this.sample = null;
    this.running = false;
    this.previewFrame = null;
    this.previewSphere = null;
    this.previewT = 0;
    this.waveformFrame = null;
    this.waveAudioCtx = null;
    this.waveSource = null;
    this.decodedChannel = null;
    this.wavePeaks = null;
    this.waveDuration = 0;
    this.waveSampleRate = 44100;
    this.wavePlayStart = 0;
    this.els = {};
  }

  bindElements() {
    this.els.main = document.getElementById("transformMain");
    this.els.log = document.getElementById("transformLogList");
    this.els.hint = document.getElementById("transformFooterHint");
    this.els.continueBtn = document.getElementById("transformContinueBtn");
    this.els.stepIndicator = document.getElementById("transformStepIndicator");
    this.els.name = document.getElementById("transformSampleName");
    this.els.meta = document.getElementById("transformMeta");

    if (this.els.continueBtn && !this.els.continueBtn.dataset.bound) {
      this.els.continueBtn.dataset.bound = "1";
      this.els.continueBtn.addEventListener("click", () => {
        if (!this.sample || !this.app) return;
        if (typeof PlateManager !== "undefined" && PlateManager.isSelected(this.sample.id)) {
          this.app.enterPlateStudio();
        } else {
          this.app.plateMode = false;
          this.app.enterAnalysisView(this.sample.id);
        }
      });
    }
  }

  async start(sample) {
    this.stop();
    this.bindElements();
    this.sample = sample;
    this.running = true;
    this.stopPreview();
    window.activeAcousticViz = null;
    window.pythonAcousticViz = null;
    window.activeAudioFeatures = null;
    window.pythonEnhancedFeatures = null;
    window.activeShapeProfile = null;
    window.activeNaturalArchetype = null;
    window.activeShapeProfileVersion = null;
    this.app.canvasInteraction?.leftField?.clearShapeProfile?.();

    if (this.els.name) this.els.name.textContent = sample.name;
    if (this.els.meta) {
      this.els.meta.textContent =
        this.app.formatDuration(sample.duration) + " · " + sample.fileName;
    }
    if (this.els.continueBtn) this.els.continueBtn.disabled = true;
    if (this.els.hint) this.els.hint.textContent = "声音 → 波形 / 频谱 / 声谱图…";

    this.renderLayout();
    this.setStepIndicator(0);
    this.logEntries = [];
    this.renderLog();

    try {
      if (sample.status === "analyzed" && sample.features && sample.visualParams) {
        await this.runPipelineFromCache(sample);
      } else {
        await this.runPipeline(sample);
      }
      if (this.els.continueBtn) this.els.continueBtn.disabled = false;
      if (this.els.hint) {
        this.els.hint.textContent = "Transformation complete — your sound is now a living brush.";
      }
    } catch (err) {
      console.error("Transform pipeline error:", err);
      if (this.els.hint) this.els.hint.textContent = "Something went wrong. Go back and try again.";
    }

    this.running = false;
  }

  stop() {
    this.running = false;
    this.stopPreview();
    this.stopWaveform();
  }

  renderLayout() {
    if (!this.els.main) return;
    this.els.main.innerHTML = `
      <section class="transform-stage" id="tsStage0" data-stage="0">
        <p class="transform-stage-label">Step 1 · Acoustic</p>
        <h3 class="transform-stage-title">波形 · 频谱 · 声谱图</h3>
        <p class="transform-stage-desc">
          Python 将声音转为视觉结构：波形（时域）· 频谱（频率能量）· 声谱图（时频）。
          分析窗口会同步弹出完整视图。
        </p>
        <div class="transform-acoustic-grid">
          <div class="transform-canvas-wrap">
            <p class="transform-mini-label">Waveform · 波形</p>
            <canvas class="transform-canvas" id="tsAcousticWave" width="720" height="100"></canvas>
          </div>
          <div class="transform-canvas-wrap">
            <p class="transform-mini-label">Spectrogram · 声谱图</p>
            <canvas class="transform-canvas" id="tsAcousticSpec" width="720" height="140"></canvas>
          </div>
          <div class="transform-canvas-wrap">
            <p class="transform-mini-label">Spectrum · 频谱</p>
            <canvas class="transform-canvas" id="tsAcousticSpectrum" width="720" height="100"></canvas>
          </div>
        </div>
        <p class="transform-acoustic-hint" id="tsAcousticHint">等待 Python 分析…</p>
      </section>

      <section class="transform-stage" id="tsStage1" data-stage="1">
        <p class="transform-stage-label">Step 2 · Extract</p>
        <h3 class="transform-stage-title">Amplitude &amp; volume</h3>
        <p class="transform-stage-desc">Measuring RMS volume, peak amplitude, and dynamic range from the waveform.</p>
        <div class="transform-metrics" id="tsVolumeMetrics"></div>
      </section>

      <section class="transform-stage" id="tsStage2" data-stage="2">
        <p class="transform-stage-label">Step 3 · Extract</p>
        <h3 class="transform-stage-title">Frequency spectrum (FFT)</h3>
        <p class="transform-stage-desc">Windowed Fourier transform reveals how energy is distributed across bass, mid, and treble bands.</p>
        <div class="transform-canvas-wrap">
          <canvas class="transform-canvas" id="tsSpectrumCanvas" width="720" height="140"></canvas>
        </div>
        <div class="transform-metrics" id="tsSpectrumMetrics"></div>
      </section>

      <section class="transform-stage" id="tsStage3" data-stage="3">
        <p class="transform-stage-label">Step 4 · Extract</p>
        <h3 class="transform-stage-title">Pitch &amp; timbre</h3>
        <p class="transform-stage-desc">Autocorrelation estimates pitch; roughness, brightness, and spectral variation describe timbral character.</p>
        <div class="transform-metrics" id="tsTimbreMetrics"></div>
      </section>

      <section class="transform-stage" id="tsStage4" data-stage="4">
        <p class="transform-stage-label">Step 5 · Map</p>
        <h3 class="transform-stage-title">Visual material mapping</h3>
        <p class="transform-stage-desc">Audio features drive color palette, motion, and particle density — the DNA of your sound brush.</p>
        <div class="transform-palette-row" id="tsPaletteRow"></div>
        <div class="transform-metrics" id="tsMappingMetrics"></div>
      </section>

      <section class="transform-stage" id="tsStage5" data-stage="5">
        <p class="transform-stage-label">Step 6 · Materialize</p>
        <h3 class="transform-stage-title">Sound breathing brush</h3>
        <p class="transform-stage-desc">Stippled particles inherit your sound's volume and spectrum — this is what you will draw with on the canvas.</p>
        <div class="transform-breathing-preview">
          <span class="transform-breathing-label">sound breathing</span>
          <div class="transform-breathing-host" id="tsBreathingHost"></div>
        </div>
      </section>
    `;
  }

  async decodeSampleBuffer(sample) {
    const arrayBuffer = await sample.file.arrayBuffer();
    const decodeCtx = new (window.AudioContext || window.webkitAudioContext)();
    try {
      let audioBuffer = await decodeCtx.decodeAudioData(arrayBuffer.slice(0));
      if (sample.source === "esp32-record" && !sample.esp32UsedPcm && sample.esp32MetricsSeries?.length >= 2) {
        const hwBuffer = await metricsToAudioBuffer(
          sample.esp32MetricsSeries, 16000, decodeCtx
        );
        if (hwBuffer) audioBuffer = hwBuffer;
      }
      return audioBuffer;
    } finally {
      decodeCtx.close().catch(() => {});
    }
  }

  async runAcousticAnalysisStep(sample) {
    const pipe = document.getElementById("pipelineStatus");
    if (pipe) {
      pipe.dataset.state = "processing";
      pipe.textContent = "Processing";
    }

    const win = window.acousticAnalysisWindow;
    let pyData = null;

    if (win) {
      win.openLoading(sample.name, `${this.app.formatDuration(sample.duration)} · ${sample.fileName}`);
      win.sampleFile = sample.file;
      win.sampleFileName = sample.fileName;
      win.sampleName = sample.name;
    }

    if (window.pythonClient) {
      pyData = await window.pythonClient.analyzeWavBlob(sample.file, sample.fileName);
    }

    if (win) {
      win.showResults(pyData, { sampleId: sample.id });
      if (pyData?.analysisExport || pyData?.brushParams) win.applyModeBBrush(pyData, sample.id);
    }

    if (pyData) {
      this.renderAcousticVisualization(pyData.acoustic);
      const ac = pyData.acoustic || {};
      this.addLog(
        "波形/频谱/声谱图就绪 · " +
        Math.round((pyData.duration || sample.duration || 0) * 10) / 10 + "s · " +
        `${ac.waveform?.length || 0} 波形点`
      );
    } else {
      if (win) win.showResults(null, { sampleId: sample.id });
      const hint = document.getElementById("tsAcousticHint");
      if (hint) hint.textContent = "Python 离线 — 请运行 python-service/start-python.ps1";
      this.addLog("Python 离线 — 无法生成声学视觉结构", true);
    }

    if (pipe) {
      pipe.dataset.state = pyData ? "processing" : "idle";
      pipe.textContent = pyData ? "Processing" : "Idle";
    }
    return pyData;
  }

  async runPipeline(sample) {
    sample.status = "analyzing";
    this.app.renderLibrary();

    // —— Step 0: sound → waveform / spectrum / spectrogram ——
    this.setStepIndicator(0);
    this.activateStage(0);
    this.addLog("声音 → 波形 / 频谱 / 声谱图…", true);
    await this.pause(400);

    const pyData = await this.runAcousticAnalysisStep(sample);
    await this.pause(600);

    // Decode WAV in background for JS feature extraction
    this.addLog("解码 WAV 用于特征提取…", true);
    const audioBuffer = await this.decodeSampleBuffer(sample);
    await this.pause(300);

    // —— Full feature extraction ——
    this.setStepIndicator(1);
    this.activateStage(1);
    this.addLog("Extracting amplitude & volume…", true);
    await this.pause(400);

    const localAnalysis = this.app.sampleAnalyzer.analyzeBuffer(audioBuffer);
    const features = FeatureSchema.normalizeFeatures(localAnalysis);
    const acoustic = pyData?.acoustic || localAnalysis.acoustic || null;
    if (!pyData && acoustic) {
      this.renderAcousticVisualization(acoustic);
      this.addLog(
        "本地声学结构就绪 · " +
        `${acoustic.waveform?.length || 0} 波形点 · ${acoustic.spectrum?.length || 0} 频谱 bins`
      );
    }
    const hwFeatures = sample.esp32MetricsSeries?.length >= 2
      ? extractFeaturesFromEsp32Metrics(sample.esp32MetricsSeries)
      : null;

    if (hwFeatures) {
      ["volume", "bass", "mid", "treble", "brightness", "energy", "roughness", "pitch", "dynamicRange"].forEach((key) => {
        features[key] = FeatureSchema.clamp01((features[key] ?? 0) * 0.55 + (hwFeatures[key] ?? 0) * 0.45);
      });
      if (hwFeatures.spectrumProfile?.length) {
        features.spectrumProfile = hwFeatures.spectrumProfile;
      }
    }

    await this.revealVolumeMetrics(features);
    this.addLog(
      "Volume " + Math.round(features.volume * 100) + "% · dynamic range " +
      Math.round(features.dynamicRange * 100) + "%"
    );
    await this.pause(800);

    // —— Spectrum ——
    this.setStepIndicator(1);
    this.activateStage(2);
    this.addLog("Running FFT frequency analysis…", true);
    await this.pause(400);
    await this.animateSpectrum(features.spectrumProfile, features);
    this.addLog(
      "Bass " + Math.round(features.bass * 100) + " · Mid " +
      Math.round(features.mid * 100) + " · Treble " + Math.round(features.treble * 100)
    );
    await this.pause(800);

    // —— Pitch & timbre ——
    this.setStepIndicator(2);
    this.activateStage(3);
    this.addLog("Estimating pitch & timbre…", true);
    await this.pause(400);
    await this.revealTimbreMetrics(features);
    const pitchHz = Math.round(50 + features.pitch * 1950);
    this.addLog("Pitch ~" + pitchHz + " Hz · timbre profile captured");
    await this.pause(800);

    // —— AI + visual mapping ——
    this.setStepIndicator(2);
    this.activateStage(4);
    this.addLog("Mapping features → visual parameters…", true);
    await this.pause(500);

    const aiResult = this.app.soundPersonalityAI.computeAll(features);
    let visualParams = this.app.visualMappingEngine.compute(
      aiResult.personality, features, aiResult
    );

    if (pyData) {
      const pyFeatures = FeatureSchema.fromPythonResult(pyData);
      Object.assign(features, FeatureSchema.mergeFeatures(features, pyFeatures, 0.55));
      if (pyData.visualModifiers) {
        visualParams = VisualParamFusion.mergeAndClamp(visualParams, pyData.visualModifiers, 0.6);
      }
      Object.assign(aiResult, this.app.soundPersonalityAI.computeAll(features));
    }

    const identity = this.app.soundPersonalityAI.generateIdentity(
      features, aiResult, visualParams
    );
    aiResult.identity = identity;

    if (pyData && typeof NaturalSoundArchetypes !== "undefined") {
      NaturalSoundArchetypes.applyFromFeatures({ ...pyData, features });
      visualParams =
        window.activeFusedVisualParams ||
        window.activeVisualParams ||
        visualParams;
    }

    sample.features = features;
    sample.aiResult = aiResult;
    sample.visualParams = visualParams;
    sample.acoustic = acoustic;
    sample.shapeProfile = acoustic?.shapeProfile || null;
    sample.status = "analyzed";
    this.app.onSampleAnalyzed(sample, "transform");

    window.activeVisualParams = visualParams;
    window.activePersonality = aiResult.personality;
    window.activeAiResult = aiResult;
    window.activeAudioFeatures = features;
    window.activeAcousticViz = acoustic;
    window.activeShapeProfile = acoustic?.shapeProfile || null;
    window.activeNaturalArchetype = pyData?.analysisExport?.naturalArchetype || null;
    window.activeShapeProfileVersion = `${sample.id}-${Date.now()}`;
    if (acoustic) window.pythonAcousticViz = acoustic;
    console.group("[Sound Shape Analysis]");
    console.log("sampleId:", sample.id);
    console.log("naturalArchetype:", window.activeNaturalArchetype);
    console.table(window.activeShapeProfile || {});
    console.groupEnd();
    window.logSoundFingerprint?.(sample.fileName || sample.name, features, acoustic);
    if (this.app.canvasInteraction && !this.app.plateMode) this.app.canvasInteraction.resetField();
    this.app.previousFeatures = features;

    await this.revealPalette(visualParams);
    await this.revealMappingMetrics(visualParams, aiResult);
    this.addLog("Palette & brush behavior generated");
    await this.pause(700);

    // —— Breathing preview ——
    this.setStepIndicator(3);
    this.activateStage(5);
    this.addLog("Materializing sound breathing brush…", true);
    await this.pause(400);
    this.startBreathingPreview(visualParams, features, acoustic);
    this.addLog("Sound brush ready — " + (identity.name || sample.name));
    const pipe = document.getElementById("pipelineStatus");
    if (pipe) {
      pipe.dataset.state = "ready";
      pipe.textContent = "Brush Ready";
    }
    this.app.renderLibrary();
  }

  async runPipelineFromCache(sample) {
    const features = sample.features;
    const visualParams = sample.visualParams;
    const aiResult = sample.aiResult;
    let acoustic = sample.acoustic || null;
    window.activeAcousticViz = acoustic;
    window.activeShapeProfile = acoustic?.shapeProfile || sample.shapeProfile || null;
    window.activeNaturalArchetype = sample.pythonAnalysis?.naturalArchetype || window.activeNaturalArchetype || null;
    window.activeShapeProfileVersion = window.activeShapeProfile ? `${sample.id}-cache-${Date.now()}` : null;

    this.setStepIndicator(0);
    this.activateStage(0);
    this.addLog("回放声学视觉结构…", true);
    await this.pause(300);

    if (acoustic) {
      const win = window.acousticAnalysisWindow;
      if (win) {
        win.sampleFile = sample.file;
        win.sampleFileName = sample.fileName;
        win.sampleName = sample.name;
        win.openLoading(
          sample.name,
          `${this.app.formatDuration(sample.duration)} · ${sample.fileName}`
        );
        win.showResults({ acoustic }, { sampleId: sample.id });
      }
      this.renderAcousticVisualization(acoustic);
      this.addLog("声学图（缓存）");
    } else if (window.pythonClient) {
      const pyData = await this.runAcousticAnalysisStep(sample);
      acoustic = pyData?.acoustic || null;
      sample.acoustic = acoustic;
      sample.shapeProfile = acoustic?.shapeProfile || null;
      window.activeAcousticViz = acoustic;
      window.activeShapeProfile = acoustic?.shapeProfile || null;
      window.activeNaturalArchetype = pyData?.analysisExport?.naturalArchetype || null;
      window.activeShapeProfileVersion = window.activeShapeProfile ? `${sample.id}-${Date.now()}` : null;
    }
    await this.pause(400);

    this.setStepIndicator(1);
    this.activateStage(1);
    this.addLog("Volume & amplitude (cached)", true);
    await this.revealVolumeMetrics(features);
    await this.pause(500);

    this.activateStage(2);
    this.addLog("Frequency spectrum (cached)", true);
    await this.animateSpectrum(features.spectrumProfile, features);
    await this.pause(500);

    this.setStepIndicator(2);
    this.activateStage(3);
    this.addLog("Pitch & timbre (cached)", true);
    await this.revealTimbreMetrics(features);
    await this.pause(500);

    this.activateStage(4);
    this.addLog("Visual mapping (cached)", true);
    await this.revealPalette(visualParams);
    await this.revealMappingMetrics(visualParams, aiResult);
    await this.pause(400);

    window.activeVisualParams = visualParams;
    window.activePersonality = aiResult.personality;
    window.activeAiResult = aiResult;
    window.activeAudioFeatures = features;
    window.activeShapeProfile = acoustic?.shapeProfile || sample.shapeProfile || null;
    window.activeNaturalArchetype = sample.pythonAnalysis?.naturalArchetype || window.activeNaturalArchetype || null;
    window.activeShapeProfileVersion = window.activeShapeProfile ? `${sample.id}-cache-ready-${Date.now()}` : null;
    console.group("[Sound Shape Analysis]");
    console.log("sampleId:", sample.id);
    console.log("naturalArchetype:", window.activeNaturalArchetype);
    console.table(window.activeShapeProfile || {});
    console.groupEnd();
    window.logSoundFingerprint?.(sample.fileName || sample.name, features, acoustic);

    this.setStepIndicator(3);
    this.activateStage(5);
    this.addLog("Sound brush ready — " + (aiResult.identity?.name || sample.name));
    this.startBreathingPreview(visualParams, features, acoustic);
  }

  activateStage(index) {
    for (let i = 0; i <= 5; i += 1) {
      const el = document.getElementById("tsStage" + i);
      if (!el) continue;
      el.classList.add("is-visible");
      el.classList.toggle("is-active", i === index);
    }
  }

  setStepIndicator(phase) {
    if (!this.els.stepIndicator) return;
    const steps = this.els.stepIndicator.querySelectorAll(".ts-step");
    steps.forEach((el, i) => {
      el.classList.remove("ts-active", "ts-done");
      if (i < phase) el.classList.add("ts-done");
      else if (i === phase) el.classList.add("ts-active");
    });
  }

  addLog(text, isCurrent) {
    this.logEntries.push({ text, isCurrent: !!isCurrent });
    if (isCurrent && this.logEntries.length > 1) {
      this.logEntries[this.logEntries.length - 2].isCurrent = false;
    }
    this.renderLog();
  }

  renderLog() {
    if (!this.els.log) return;
    this.els.log.innerHTML = this.logEntries.map(e =>
      `<li class="${e.isCurrent ? "is-current" : ""}">${e.text}</li>`
    ).join("");
    this.els.log.parentElement.scrollTop = this.els.log.parentElement.scrollHeight;
  }

  pause(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  mixDownChannel(audioBuffer) {
    const length = audioBuffer.length;
    const out = new Float32Array(length);
    const nCh = audioBuffer.numberOfChannels;
    for (let c = 0; c < nCh; c++) {
      const ch = audioBuffer.getChannelData(c);
      for (let i = 0; i < length; i++) out[i] += ch[i] / nCh;
    }
    return out;
  }

  buildPeakEnvelope(channel, points) {
    const peaks = new Float32Array(points);
    const bucket = channel.length / points;
    for (let i = 0; i < points; i++) {
      const midIdx = Math.min(channel.length - 1, Math.floor((i + 0.5) * bucket));
      peaks[i] = channel[midIdx];
    }
    return peaks;
  }

  async revealAndPlayDecodedWaveform(audioBuffer, sample) {
    this.decodedChannel = this.mixDownChannel(audioBuffer);
    this.waveDuration = audioBuffer.duration;
    this.waveSampleRate = audioBuffer.sampleRate;
    this.wavePeaks = this.buildPeakEnvelope(this.decodedChannel, 720);

    const snapshot = new Float32Array(400);
    for (let i = 0; i < 400; i++) {
      snapshot[i] = this.decodedChannel[Math.floor(i * this.decodedChannel.length / 400)];
    }
    sample.waveformSnapshot = snapshot;

    await this.revealWaveformScan();
    this.startLiveDecodedWaveform(audioBuffer);
  }

  getWavePlaybackTime() {
    if (this.waveDuration <= 0) return 0;
    if (this.waveAudioCtx) {
      const t = this.waveAudioCtx.currentTime - this.wavePlayStart;
      return ((t % this.waveDuration) + this.waveDuration) % this.waveDuration;
    }
    const t = (performance.now() - this.waveWallStart) / 1000;
    return ((t % this.waveDuration) + this.waveDuration) % this.waveDuration;
  }

  revealWaveformScan() {
    return new Promise(resolve => {
      const canvas = document.getElementById("tsWaveCanvas");
      if (!canvas || !this.decodedChannel) { resolve(); return; }
      const g = canvas.getContext("2d");
      const w = canvas.width;
      const h = canvas.height;
      let alpha = 0;
      const t0 = performance.now();

      const draw = () => {
        alpha = Math.min(1, alpha + 0.06);
        const t = this.waveDuration > 0
          ? ((performance.now() - t0) / 1000) % this.waveDuration
          : 0;
        this.drawFloatingWaveformFrame(g, w, h, t, alpha);
        if (alpha < 1) requestAnimationFrame(draw);
        else resolve();
      };
      draw();
    });
  }

  drawFloatingWaveformFrame(g, w, h, playbackTime, strength) {
    const channel = this.decodedChannel;
    if (!channel || !channel.length) return;

    const mid = h * 0.5;
    g.fillStyle = "#f5f4f2";
    g.fillRect(0, 0, w, h);

    const t = playbackTime ?? this.getWavePlaybackTime();
    const playIdx = Math.floor(t * this.waveSampleRate);
    const visibleSec = 2.2;
    const samplesPerPx = (this.waveSampleRate * visibleSec) / w;
    const ampScale = mid * 0.8 * (strength ?? 1);

    const sampleAt = (idx) => {
      const wrapped = ((idx % channel.length) + channel.length) % channel.length;
      return channel[wrapped];
    };

    const drawWave = (stroke, fill, lineW, offsetPx) => {
      g.strokeStyle = stroke;
      g.lineWidth = lineW;
      g.beginPath();
      for (let x = 0; x < w; x++) {
        const idx = playIdx - Math.floor((w - x) * samplesPerPx) + offsetPx;
        const y = mid + sampleAt(idx) * ampScale;
        if (x === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();

      if (fill) {
        g.fillStyle = fill;
        g.beginPath();
        g.moveTo(0, mid);
        for (let x = 0; x < w; x++) {
          const idx = playIdx - Math.floor((w - x) * samplesPerPx) + offsetPx;
          g.lineTo(x, mid + sampleAt(idx) * ampScale);
        }
        g.lineTo(w, mid);
        g.closePath();
        g.fill();
      }
    };

    drawWave(
      `rgba(61, 107, 82, ${0.9 * (strength ?? 1)})`,
      null,
      1.5,
      0
    );
  }

  startLiveDecodedWaveform(audioBuffer) {
    this.stopWaveform();

    const canvas = document.getElementById("tsWaveCanvas");
    if (!canvas || !this.decodedChannel || !this.wavePeaks) return;

    this.waveAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    this.waveAnalyser = this.waveAudioCtx.createAnalyser();
    this.waveAnalyser.fftSize = 2048;
    this.waveAnalyser.smoothingTimeConstant = 0.48;
    const gain = this.waveAudioCtx.createGain();
    gain.gain.value = 0.42;
    this.waveSource = this.waveAudioCtx.createBufferSource();
    this.waveSource.buffer = audioBuffer;
    this.waveSource.loop = true;
    this.waveSource.connect(gain);
    gain.connect(this.waveAnalyser);
    this.waveAnalyser.connect(this.waveAudioCtx.destination);
    this.wavePlayStart = this.waveAudioCtx.currentTime;
    this.waveWallStart = performance.now();
    this.waveSource.start(0);
    if (this.waveAudioCtx.state === "suspended") {
      this.waveAudioCtx.resume().catch(() => {});
    }

    const g = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;

    g.fillStyle = "#f5f4f2";
    g.fillRect(0, 0, w, h);

    const tick = () => {
      if (!document.getElementById("tsWaveCanvas")) return;
      const t = this.getWavePlaybackTime();
      this.drawFloatingWaveformFrame(g, w, h, t, 1);
      this.waveformFrame = requestAnimationFrame(tick);
    };

    tick();
  }

  stopWaveform() {
    if (this.waveformFrame) {
      cancelAnimationFrame(this.waveformFrame);
      this.waveformFrame = null;
    }
    if (this.waveSource) {
      try { this.waveSource.stop(); } catch (e) { /* already stopped */ }
      this.waveSource.disconnect();
      this.waveSource = null;
    }
    this.waveAnalyser = null;
    if (this.waveAudioCtx) {
      this.waveAudioCtx.close().catch(() => {});
      this.waveAudioCtx = null;
    }
  }

  metricHtml(label, valueText, pct) {
    return `<div class="transform-metric">
      <div class="transform-metric-label">${label}</div>
      <div class="transform-metric-value">${valueText}</div>
      <div class="transform-metric-bar"><div class="transform-metric-fill" data-pct="${pct}"></div></div>
    </div>`;
  }

  fillMetricBars(container) {
    if (!container) return;
    requestAnimationFrame(() => {
      container.querySelectorAll(".transform-metric-fill").forEach(el => {
        el.style.width = (parseFloat(el.dataset.pct) * 100) + "%";
      });
    });
  }

  async revealVolumeMetrics(f) {
    const el = document.getElementById("tsVolumeMetrics");
    if (!el) return;
    el.innerHTML =
      this.metricHtml("Volume (RMS)", Math.round(f.volume * 100) + "%", f.volume) +
      this.metricHtml("Peak amplitude", Math.round(f.energy * 100) + "%", f.energy) +
      this.metricHtml("Dynamic range", Math.round(f.dynamicRange * 100) + "%", f.dynamicRange);
    await this.pause(80);
    this.fillMetricBars(el);
  }

  animateSpectrum(profile, f) {
    return new Promise(resolve => {
      const canvas = document.getElementById("tsSpectrumCanvas");
      if (!canvas || !profile) { resolve(); return; }
      const g = canvas.getContext("2d");
      const w = canvas.width;
      const h = canvas.height;
      const bars = profile.length;
      let progress = 0;

      const draw = () => {
        progress = Math.min(1, progress + 0.05);
        g.clearRect(0, 0, w, h);
        g.fillStyle = "#f5f4f2";
        g.fillRect(0, 0, w, h);

        const barW = w / bars;
        for (let i = 0; i < bars; i++) {
          const t = i / bars;
          const barH = profile[i] * (h - 16) * progress;
          const r = Math.round(60 + t * 40);
          const gr = Math.round(100 + (1 - t) * 60);
          const b = Math.round(80 + t * 30);
          g.fillStyle = `rgb(${r},${gr},${b})`;
          g.fillRect(i * barW + 1, h - barH - 8, Math.max(1, barW - 2), barH);
        }

        if (progress < 1) requestAnimationFrame(draw);
        else {
          const metrics = document.getElementById("tsSpectrumMetrics");
          if (metrics) {
            metrics.innerHTML =
              this.metricHtml("Bass", Math.round(f.bass * 100) + "%", f.bass) +
              this.metricHtml("Mid", Math.round(f.mid * 100) + "%", f.mid) +
              this.metricHtml("Treble", Math.round(f.treble * 100) + "%", f.treble) +
              this.metricHtml("Brightness", Math.round(f.brightness * 100) + "%", f.brightness);
            this.fillMetricBars(metrics);
          }
          resolve();
        }
      };
      draw();
    });
  }

  async revealTimbreMetrics(f) {
    const el = document.getElementById("tsTimbreMetrics");
    if (!el) return;
    const pitchHz = Math.round(50 + f.pitch * 1950);
    el.innerHTML =
      this.metricHtml("Pitch", pitchHz + " Hz", f.pitch) +
      this.metricHtml("Roughness", Math.round(f.roughness * 100) + "%", f.roughness) +
      this.metricHtml("Spectral variation", Math.round(f.spectralVariation * 100) + "%", f.spectralVariation) +
      this.metricHtml("Timbre brightness", Math.round(f.brightness * 100) + "%", f.brightness);
    await this.pause(80);
    this.fillMetricBars(el);
  }

  async revealPalette(vp) {
    const row = document.getElementById("tsPaletteRow");
    if (!row || !vp.palette) return;
    row.innerHTML = vp.palette.map((c, i) =>
      `<div class="transform-swatch" style="background:rgb(${c.r},${c.g},${c.b});transition-delay:${i * 80}ms"></div>`
    ).join("");
    await this.pause(60);
    row.querySelectorAll(".transform-swatch").forEach(s => s.classList.add("is-visible"));
  }

  async revealMappingMetrics(vp, aiResult) {
    const el = document.getElementById("tsMappingMetrics");
    if (!el) return;
    const p = aiResult.personality || {};
    el.innerHTML =
      this.metricHtml("Motion speed", Math.round(vp.motionSpeed * 100) + "%", vp.motionSpeed) +
      this.metricHtml("Particle density", Math.round(vp.particleDensity * 100) + "%", vp.particleDensity) +
      this.metricHtml("Energy", Math.round((p.energy || 0) * 100) + "%", p.energy || 0) +
      this.metricHtml("Calmness", Math.round((p.calmness || 0) * 100) + "%", p.calmness || 0);
    await this.pause(80);
    this.fillMetricBars(el);
  }

  renderAcousticVisualization(acoustic) {
    const hint = document.getElementById("tsAcousticHint");
    if (hint && acoustic) {
      hint.textContent =
        `Python 视觉结构 · 波形 ${acoustic.waveform?.length || 0} 点 · ` +
        `频谱 ${acoustic.spectrum?.length || 0} bins · ` +
        `声谱图 ${acoustic.spectrogram?.length || 0}×${acoustic.spectrogram?.[0]?.length || 0}`;
    } else if (hint) {
      hint.textContent = "等待 Python 分析…";
    }

    AcousticAnalysisWindow.renderCanvases(acoustic, "tsAcoustic");
    if (window.acousticAnalysisWindow?.isOpen?.()) {
      AcousticAnalysisWindow.renderCanvases(acoustic, "acousticWin");
      window.acousticAnalysisWindow.updateStatus?.({ acoustic });
    }
  }

  startBreathingPreview(vp, features, acoustic = window.activeAcousticViz) {
    const host = document.getElementById("tsBreathingHost");
    if (!host || typeof SoundMembraneSphere === "undefined") return;

    this.stopPreview();
    host.innerHTML = "";

    window.activeAudioFeatures = features;
    window.activeAcousticViz = acoustic || null;
    window.activeShapeProfile = acoustic?.shapeProfile || null;
    // Self-contained: mounts its own canvas and runs its own animation loop.
    this.previewSphere = new SoundMembraneSphere(host, {
      seed: 42,
      enableShapeMorph: true,
      shapeMorphStrength: 0.76
    });
    this.previewSphere.applyAcousticViz?.(acoustic || null, {
      playbackTimeProvider: () => window.App?.playbackAudio?.currentTime ?? null,
      enableShapeMorph: true,
      shapeMorphStrength: 0.76
    });
    this.previewSphere.updateShapeProfile?.(
      acoustic?.shapeProfile || null,
      window.activeNaturalArchetype,
      { enabled: true, strength: 0.76 }
    );
    if (vp?.palette) this.previewSphere.updatePalette(vp.palette);
    if (features) {
      this.previewSphere.updateAudioState({
        bass: features.bass,
        lowMid: (features.mid ?? 0) * 0.88,
        mid: features.mid,
        treble: features.treble,
        level: features.volume ?? features.energy,
        flux: features.spectralVariation ?? features.roughness ?? 0
      });
    }
  }

  stopPreview() {
    if (this.previewFrame) {
      cancelAnimationFrame(this.previewFrame);
      this.previewFrame = null;
    }
    if (this.previewSphere) {
      this.previewSphere.dispose();
      this.previewSphere = null;
    }
  }

  gaussianRandom() {
    if (typeof randomGaussian === "function") return randomGaussian(0, 1);
    let u = 0;
    let v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  lerp(a, b, t) {
    if (typeof window.lerp === "function") return window.lerp(a, b, t);
    return a + (b - a) * t;
  }
}

window.SoundTransformView = SoundTransformView;
