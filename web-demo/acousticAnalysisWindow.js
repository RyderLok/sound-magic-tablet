// Dedicated in-app window: Python librosa — sound → visual structure.
class AcousticAnalysisWindow {
  constructor() {
    this.els = {};
    this.sampleFile = null;
    this.sampleFileName = "";
    this.sampleName = "";
    this.lastPyData = null;
    this._bound = false;
  }

  bind() {
    if (this._bound) return;
    this._bound = true;

    this.els.root = document.getElementById("acousticAnalysisModal");
    this.els.backdrop = document.getElementById("acousticWinBackdrop");
    this.els.title = document.getElementById("acousticWinTitle");
    this.els.meta = document.getElementById("acousticWinMeta");
    this.els.hint = document.getElementById("acousticWinHint");
    this.els.loading = document.getElementById("acousticWinLoading");
    this.els.body = document.getElementById("acousticWinBody");
    this.els.brushBtn = document.getElementById("acousticWinBrushBtn");
    this.els.transformBtn = document.getElementById("acousticWinTransformBtn");
    this.els.exportPanel = document.getElementById("acousticWinExport");
    this.els.closeBtn = document.getElementById("acousticWinCloseBtn");

    const close = () => this.close();
    this.els.closeBtn?.addEventListener("click", close);
    this.els.backdrop?.addEventListener("click", close);

    this.els.transformBtn?.addEventListener("click", () => {
      const sampleId = this.els.transformBtn?.dataset.sampleId;
      this.applyModeBBrush(this.lastPyData, sampleId);
      this.close();
      if (sampleId && window.App?.enterTransformView) {
        window.App.enterTransformView(sampleId);
      }
    });

    this.els.brushBtn?.addEventListener("click", () => {
      const sampleId = this.els.transformBtn?.dataset.sampleId || "";
      this.applyModeBBrush(this.lastPyData, sampleId);
      if (this.els.hint) {
        this.els.hint.textContent = "视觉结构 + Brush 已写入 p5 管线 — 可进入 Draw 或继续 Transform";
      }
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !this.els.root?.classList.contains("hidden")) close();
    });
  }

  openLoading(sampleName, metaText = "") {
    this.bind();
    if (!this.els.root) return;

    if (this.els.title) this.els.title.textContent = sampleName || "声学分析";
    if (this.els.meta) {
      this.els.meta.textContent = metaText || "声音 → 波形 · 频谱 · 声谱图";
    }
    if (this.els.hint) {
      this.els.hint.textContent = "Python 正在分析：波形 / 频谱 / 声谱图…";
    }
    if (this.els.loading) this.els.loading.classList.remove("hidden");
    if (this.els.body) this.els.body.classList.add("hidden");
    if (this.els.brushBtn) this.els.brushBtn.disabled = true;

    this.els.root.classList.remove("hidden");
    document.body.classList.add("acoustic-win-open");
  }

  close() {
    this.els.root?.classList.add("hidden");
    document.body.classList.remove("acoustic-win-open");
  }

  isOpen() {
    return this.els.root && !this.els.root.classList.contains("hidden");
  }

  async analyzeAndShow(file, fileName, options = {}) {
    this.sampleFile = file;
    this.sampleFileName = fileName || "recording.wav";
    this.sampleName = options.sampleName || fileName || "声学分析";

    const meta = [
      options.duration ? `${options.duration.toFixed(1)}s` : null,
      fileName
    ].filter(Boolean).join(" · ");

    this.openLoading(this.sampleName, meta);

    let pyData = null;
    if (window.pythonClient) {
      pyData = await window.pythonClient.analyzeWavBlob(file, this.sampleFileName);
    }

    this.showResults(pyData, { sampleId: options.sampleId });
    if (pyData?.brushParams) {
      this.applyModeBBrush(pyData, options.sampleId);
    }
    return pyData;
  }

  showResults(pyData, options = {}) {
    this.lastPyData = pyData;
    this.bind();

    if (this.els.loading) this.els.loading.classList.add("hidden");
    if (this.els.body) this.els.body.classList.remove("hidden");

    if (this.els.transformBtn) {
      this.els.transformBtn.dataset.sampleId = options.sampleId || "";
      this.els.transformBtn.classList.toggle("hidden", !options.sampleId);
    }

    if (pyData?.acoustic) {
      AcousticAnalysisWindow.renderCanvases(pyData.acoustic, "acousticWin");
    } else {
      AcousticAnalysisWindow.clearCanvases("acousticWin");
    }

    this.updateStatus(pyData);
    this.renderExportPanel(pyData?.analysisExport, pyData?.features, pyData?.brushParams);

    if (this.els.brushBtn) {
      this.els.brushBtn.disabled = !pyData?.brushParams;
    }
  }

  updateStatus(pyData) {
    if (!this.els.hint) return;
    if (!pyData) {
      this.els.hint.textContent = "Python 服务不可用 — 请运行 python-service\\start-python.ps1";
      return;
    }
    const ac = pyData.acoustic || {};
    this.els.hint.textContent =
      `视觉结构就绪 · 波形 ${ac.waveform?.length || 0} 点 · ` +
      `频谱 ${ac.spectrum?.length || 0} bins · ` +
      `声谱图 ${ac.spectrogram?.length || 0}×${ac.spectrogram?.[0]?.length || 0}`;
  }

  renderExportPanel(analysisExport, features, brushParams) {
    const el = this.els.exportPanel;
    if (!el) return;
    if (!analysisExport && !features) {
      el.classList.add("hidden");
      el.innerHTML = "";
      return;
    }
    el.classList.remove("hidden");
    const exp = analysisExport || {};
    const arch = exp.naturalArchetype;
    const vs = exp.visualStructure;
    const shape = exp.shapeProfile || window.activeAcousticViz?.shapeProfile || {};
    const fmt = (v) => (v == null ? "—" : v);
    const pct = (v) => `${Math.round((v || 0) * 100)}%`;
    el.innerHTML = `
      <p class="acoustic-export-title">声音 → 视觉结构 · 特征导出</p>
      ${arch ? `<p class="acoustic-export-arch"><b>自然声类型</b>${arch.labelZh} · 匹配 ${pct(arch.confidence)}</p>` : ""}
      ${vs ? `<p class="acoustic-export-vs"><b>视觉笔刷</b>${NaturalSoundArchetypes?.patternLabels?.[vs.strokePattern]?.zh || vs.strokePattern} · ${vs.motionModel} · ${vs.texturePattern}</p>` : ""}
      <div class="acoustic-export-grid">
        <div class="acoustic-export-item"><b>时长</b>${fmt(exp.duration)}s · ${fmt(exp.sampleRate)} Hz</div>
        <div class="acoustic-export-item"><b>基音</b>${fmt(exp.pitchHz)} Hz</div>
        <div class="acoustic-export-item"><b>节奏</b>${fmt(exp.tempoBpm)} BPM</div>
        <div class="acoustic-export-item"><b>低频</b>${pct(exp.bandEnergy?.bass ?? features?.bass)}</div>
        <div class="acoustic-export-item"><b>中频</b>${pct(exp.bandEnergy?.mid ?? features?.mid)}</div>
        <div class="acoustic-export-item"><b>高频</b>${pct(exp.bandEnergy?.treble ?? features?.treble)}</div>
        <div class="acoustic-export-item"><b>Shape</b>P ${pct(shape.plume)} · Rb ${pct(shape.ribbon)} · Rg ${pct(shape.ring)}</div>
        <div class="acoustic-export-item"><b>Morph</b>B ${pct(shape.burst)} · C ${pct(shape.cluster)}</div>
        <div class="acoustic-export-item"><b>Brush 密度</b>${pct(brushParams?.density ?? brushParams?.particleDensity)}</div>
        <div class="acoustic-export-item"><b>Brush 湍流</b>${pct(brushParams?.turbulence)}</div>
      </div>`;
  }

  applyModeBBrush(pyData, sampleId) {
    if (!pyData) return null;
    const features = FeatureSchema.normalizeFeatures(pyData.features || {});
    const modifiers = pyData.visualModifiers || {};
    const brush = pyData.brushParams || null;

    window.pythonAnalysisExport = pyData.analysisExport || null;
    window.pythonVisualStructure = pyData.analysisExport?.visualStructure || null;

    if (window.App?.visualMappingEngine && window.App?.soundPersonalityAI && features) {
      const aiResult = window.App.soundPersonalityAI.computeAll(features);
      window.activeVisualParams = window.App.visualMappingEngine.compute(
        aiResult.personality, features, aiResult
      );
      window.activePersonality = aiResult.personality;
      window.activeAiResult = aiResult;
    }

    window.pythonEnhancedFeatures = features;
    window.pythonVisualModifiers = modifiers;
    window.pythonBrushParams = brush;
    window.pythonAcousticViz = pyData.acoustic || null;
    window.activeAcousticViz = pyData.acoustic || null;
    window.activeShapeProfile = pyData.acoustic?.shapeProfile || null;
    window.activeNaturalArchetype = pyData.analysisExport?.naturalArchetype || null;
    window.activeShapeProfileVersion = `${sampleId || "sample"}-${Date.now()}`;

    console.group("[Sound Shape Analysis]");
    console.log("sampleId:", sampleId);
    console.log("naturalArchetype:", window.activeNaturalArchetype);
    console.table(window.activeShapeProfile || {});
    console.groupEnd();

    if (window.pythonClient) {
      window.pythonClient.lastFeatures = features;
      window.pythonClient.lastModifiers = modifiers;
      window.pythonClient.lastBrush = brush;
    }

    let visualParams = window.activeVisualParams || {};
    if (modifiers && Object.keys(modifiers).length && typeof VisualParamFusion !== "undefined") {
      visualParams = VisualParamFusion.mergeAndClamp(visualParams, modifiers, 0.65);
    }
    if (brush && typeof BrushSchema !== "undefined") {
      window.activeBrushParams = brush;
      visualParams = BrushSchema.applyToVisualParams(visualParams, brush);
    }

    window.activeVisualParams = visualParams;
    if (typeof NaturalSoundArchetypes !== "undefined") {
      NaturalSoundArchetypes.applyFromFeatures({ ...pyData, features });
      visualParams =
        window.activeFusedVisualParams ||
        window.activeVisualParams ||
        visualParams;
    }

    window.activeVisualParams = visualParams;
    window.activeFusedVisualParams = visualParams;
    window.activeAudioFeatures = features;
    window.activeAcousticViz = pyData?.acoustic || null;
    window.activeShapeProfile = pyData?.acoustic?.shapeProfile || null;
    window.activeNaturalArchetype = pyData?.analysisExport?.naturalArchetype || null;
    window.activeShapeProfileVersion = `${sampleId || "sample"}-${Date.now()}`;
    window.logSoundFingerprint?.(this.sampleFileName || "recording", features, window.activeAcousticViz);

    if (sampleId && window.App) {
      const sample = window.App.soundLibrary?.find((s) => s.id === sampleId);
      if (sample) {
        sample.features = FeatureSchema.mergeFeatures(sample.features || {}, features, 0.6);
        sample.pythonAnalysis = pyData.analysisExport;
        sample.pythonBrush = brush;
        sample.acoustic = pyData.acoustic || null;
        sample.shapeProfile = pyData.acoustic?.shapeProfile || null;
        sample.visualParams = visualParams;
        sample.status = "analyzed";
        window.App.onSampleAnalyzed(sample, "acoustic");
        if (window.App.plateMode && sample.id === PlateManager.activeBrushId) {
          window.App.applyActiveBrushGlobals(false);
          window.App.renderBrushStrip();
          window.App.renderPlateInterpretationPanel(sample, PlateManager.count());
        }
      }
    }

    const pipe = document.getElementById("pipelineStatus");
    if (pipe) {
      pipe.dataset.state = "ready";
      pipe.textContent = "Brush Ready";
    }
    return { features, modifiers, brush, visualParams };
  }

  static clearCanvases(prefix) {
    ["Wave", "Spec", "Spectrum"].forEach((suffix) => {
      const c = document.getElementById(prefix + suffix);
      if (!c) return;
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#f5f4f2";
      ctx.fillRect(0, 0, c.width, c.height);
    });
  }

  static renderCanvases(acoustic, prefix) {
    if (!acoustic) return;

    const waveC = document.getElementById(prefix + "Wave");
    const specC = document.getElementById(prefix + "Spec");
    const spectrumC = document.getElementById(prefix + "Spectrum");

    if (waveC && acoustic.waveform?.length) {
      const ctx = waveC.getContext("2d");
      const w = waveC.width;
      const h = waveC.height;
      const mid = h / 2;
      ctx.fillStyle = "#f5f4f2";
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = "#3d6b52";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      acoustic.waveform.forEach((v, i) => {
        const x = (i / Math.max(1, acoustic.waveform.length - 1)) * w;
        const y = mid - v * mid * 0.9;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }

    if (specC && acoustic.spectrogram?.length) {
      const ctx = specC.getContext("2d");
      const rows = acoustic.spectrogram;
      const cols = rows[0]?.length || 1;
      const cellW = specC.width / cols;
      const cellH = specC.height / rows.length;
      rows.forEach((row, ri) => {
        row.forEach((val, ci) => {
          const g = Math.floor(val * 220);
          ctx.fillStyle = `rgb(${g * 0.3}, ${g * 0.55 + 40}, ${g * 0.35 + 30})`;
          ctx.fillRect(ci * cellW, ri * cellH, cellW + 0.5, cellH + 0.5);
        });
      });
    }

    if (spectrumC && acoustic.spectrum?.length) {
      const ctx = spectrumC.getContext("2d");
      const w = spectrumC.width;
      const h = spectrumC.height;
      ctx.fillStyle = "#f5f4f2";
      ctx.fillRect(0, 0, w, h);
      const n = acoustic.spectrum.length;
      ctx.fillStyle = "#4a7a5a";
      for (let i = 0; i < n; i++) {
        const barH = acoustic.spectrum[i] * h * 0.92;
        const x = (i / n) * w;
        const bw = w / n;
        ctx.fillRect(x, h - barH, bw, barH);
      }
    }
  }
}

window.acousticAnalysisWindow = new AcousticAnalysisWindow();
window.AcousticAnalysisWindow = AcousticAnalysisWindow;
