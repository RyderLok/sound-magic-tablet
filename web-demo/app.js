// Application controller — library view, analysis pipeline, interpretation panel.
const App = {
  soundLibrary: [],
  selectedSampleId: null,
  previousFeatures: null,
  plateMode: false,
  _plateCanvasInitialized: false,

  canvasInteraction: null,
  sampleAnalyzer: null,
  soundPersonalityAI: null,
  visualMappingEngine: null,

  defaultPersonality: {
    energy: 0.06, calmness: 0.94, playfulness: 0.05, curiosity: 0.05, warmth: 0.32
  },

  playbackAudio: null,
  playbackUrl: null,
  playbackSampleId: null,
  playbackAudioCtx: null,
  playbackAnalyser: null,
  playbackSource: null,
  playbackGain: null,

  bootstrapServices() {
    if (this._servicesBootstrapped) return;
    this._servicesBootstrapped = true;

    if (!this.esp32AudioAdapter) {
      this.esp32AudioAdapter = new Esp32AudioAdapter({ url: "ws://localhost:8765" });
      window.esp32AudioAdapter = this.esp32AudioAdapter;
      this.esp32AudioAdapter.connect();
    }

    if (!this.pythonClient) {
      this.pythonClient = new PythonEnhancementClient({
        httpBase: "http://localhost:8001",
        wsUrl: "ws://localhost:8001/ws/audio"
      });
      window.pythonClient = this.pythonClient;
      this.pythonClient.connect();
    }

    this.esp32AudioAdapter.onPcmForPython = (bytes, sampleRate) => {
      this.pythonClient?.pushPcmFrame(bytes, sampleRate);
    };

    if (!this.serviceConnection) {
      this.serviceConnection = new ServiceConnectionManager(this);
      window.serviceConnection = this.serviceConnection;
    }
    this.serviceConnection.start();
    this.bindIntegrationPanel();
  },

  init() {
    this.bootstrapServices();

    if (this._uiInitialized) return;
    this._uiInitialized = true;

    this.transformView = new SoundTransformView(this);

    this.fieldRecorder = new FieldRecorder(this);
    this.fieldRecorder.bindElements();
    this.bindUploadModal();
    this.bindPlatePanel();

    PlateManager.load();

    document.getElementById("backBtn")?.addEventListener("click", () => this.enterLibraryView());
    document.getElementById("transformBackBtn")?.addEventListener("click", () => this.enterLibraryView());
    document.getElementById("clearCanvasBtn")?.addEventListener("click", () => {
      if (this.canvasInteraction) this.canvasInteraction.resetField();
    });
    this.bindCanvasTools();

    if (this.visualMappingEngine) {
      window.activeVisualParams = this.visualMappingEngine.compute(this.defaultPersonality);
      window.activePersonality = { ...this.defaultPersonality };
    }

    this.renderLibrary();
    this.renderPlatePanel();
    this._loadLibraryFromStore();
  },

  async _loadLibraryFromStore() {
    if (typeof SampleLibraryStore === "undefined") return;
    const stored = await SampleLibraryStore.loadAll();
    if (stored.length) {
      this.soundLibrary = stored;
      if (typeof PlateManager !== "undefined" && typeof PlateManager.prune === "function") {
        PlateManager.prune(this);
      }
      this.renderLibrary();
      this.renderPlatePanel();
    }
  },

  persistSample(sample) {
    if (!sample || typeof SampleLibraryStore === "undefined") return;
    sample.updatedAt = Date.now();
    SampleLibraryStore.saveSample(sample);
  },

  onSampleAnalyzed(sample, source = "transform") {
    if (!sample) return;
    if (typeof SampleLibraryStore !== "undefined") {
      SampleLibraryStore.appendAnalysisHistory(sample, {
        type: source,
        features: sample.features,
        visualParams: sample.visualParams,
        acoustic: sample.acoustic,
        shapeProfile: sample.shapeProfile
      });
    }
    this.persistSample(sample);
    this.renderLibrary();
    this.renderPlatePanel();
  },

  bindPlatePanel() {
    document.getElementById("openPlateStudioBtn")?.addEventListener("click", () => {
      this.enterPlateStudio();
    });
    document.getElementById("clearPlateBtn")?.addEventListener("click", () => {
      PlateManager.selectedIds = [];
      PlateManager.activeBrushId = null;
      PlateManager.save();
      this._plateCanvasInitialized = false;
      this.renderPlatePanel();
      this.renderLibrary();
    });
  },

  bindCanvasTools() {
    const drawBtn = document.getElementById("canvasToolDrawBtn");
    const eraseBtn = document.getElementById("canvasToolEraseBtn");
    drawBtn?.addEventListener("click", () => this.setCanvasTool("draw"));
    eraseBtn?.addEventListener("click", () => this.setCanvasTool("erase"));
  },

  setCanvasTool(tool) {
    const mode = tool === "erase" ? "erase" : "draw";
    if (this.canvasInteraction) this.canvasInteraction.setCanvasTool(mode);
    document.getElementById("canvasToolDrawBtn")?.classList.toggle("is-active", mode === "draw");
    const eraseBtn = document.getElementById("canvasToolEraseBtn");
    eraseBtn?.classList.toggle("is-active", mode === "erase");
    if (eraseBtn) eraseBtn.dataset.tool = "erase";
  },

  togglePlateSelection(sampleId) {
    const sample = this.soundLibrary.find((s) => s.id === sampleId);
    if (!sample) return;

    if (PlateManager.isSelected(sampleId)) {
      PlateManager.toggle(this, sampleId);
      this.renderPlatePanel();
      this.renderLibrary();
      return;
    }

    if (PlateManager.count() >= PlateManager.MAX_BRUSHES) {
      alert(`画板最多选择 ${PlateManager.MAX_BRUSHES} 段录音。`);
      return;
    }

    const added = PlateManager.toggle(this, sampleId);
    if (added === false) {
      alert(`画板最多选择 ${PlateManager.MAX_BRUSHES} 段录音。`);
      return;
    }
    this.renderPlatePanel();
    this.renderLibrary();
  },

  renderPlatePanel() {
    const countEl = document.getElementById("plateCountLabel");
    const chipsEl = document.getElementById("plateBrushChips");
    const pickerEl = document.getElementById("platePickerGrid");
    const openBtn = document.getElementById("openPlateStudioBtn");
    const hintEl = document.getElementById("plateHint");
    if (!countEl) return;

    const n = PlateManager.count();
    countEl.textContent = `${n} / ${PlateManager.MAX_BRUSHES} brush`;

    if (pickerEl) {
      if (!this.soundLibrary.length) {
        pickerEl.innerHTML = `<p class="plate-picker-empty">暂无录音 — 先在上方录制并保存</p>`;
      } else {
        pickerEl.innerHTML = this.soundLibrary.map((s) => {
          const selected = PlateManager.isSelected(s.id);
          const ready = PlateManager.isBrushReady(s);
          const pal = s.visualParams?.palette?.[0];
          const accent = pal ? `rgb(${pal.r},${pal.g},${pal.b})` : "#b8b0a8";
          const statusText = ready ? "可入画板" : "需 Transform";
          return `<button type="button" class="plate-picker-item${selected ? " is-selected" : ""}${ready ? " is-ready" : " is-pending"}"
            style="--plate-accent:${accent}"
            onclick="App.togglePlateSelection('${s.id}')"
            aria-pressed="${selected}">
            <span class="plate-picker-check">${selected ? "✓" : "+"}</span>
            <span class="plate-picker-name">${s.name}</span>
            <span class="plate-picker-dur">${this.formatDuration(s.duration)}</span>
            <span class="plate-picker-status">${statusText}</span>
            ${!ready ? `<span class="plate-picker-action" onclick="event.stopPropagation();App.enterTransformView('${s.id}')">Transform →</span>` : ""}
          </button>`;
        }).join("");
      }
    }

    const samples = PlateManager.getSelectedSamples(this);
    if (chipsEl) {
      if (!samples.length) {
        chipsEl.innerHTML = `<span class="plate-chip-empty">在下方库中勾选录音加入画板</span>`;
      } else {
        chipsEl.innerHTML = samples.map((s) => {
          const c = s.visualParams?.palette?.[0];
          const bg = c ? `rgb(${c.r},${c.g},${c.b})` : "#ccc";
          return `<span class="plate-chip" style="border-left:4px solid ${bg}">${s.name}</span>`;
        }).join("");
      }
    }

    const notReady = PlateManager.notBrushReadyNames(this);
    const canOpen = n > 0 && notReady.length === 0;
    if (openBtn) openBtn.disabled = !canOpen;

    if (hintEl) {
      if (!this.soundLibrary.length) {
        hintEl.textContent = "录制并保存后，在此点击选择录音。";
      } else if (n === 0) {
        hintEl.textContent = "↑ 点击上方卡片上的 ＋ 选择录音（最多 5 段）。";
      } else if (notReady.length) {
        hintEl.textContent = `已选 ${n} 段；请先 Transform：${notReady.join("、")}（卡片上可点 Transform →）`;
      } else {
        hintEl.textContent = `${n} 段已就绪，可进入色盘画板。进入后切换 brush 在同一块 plate 上绘画。`;
      }
    }
  },

  applyActiveBrushGlobals(clearCanvas = false) {
    const built = PlateManager.buildPlateVisualParams(this);
    if (!built?.active) return null;

    const { active, visualParams } = built;
    PlateManager.activeBrushId = active.id;
    this.selectedSampleId = active.id;

    // 与 P1/P2 预览「所见即所得」对齐：画板直接用样本自己的 visualParams
    // （原始 palette + strokePattern），不再用 applyFromFeatures 重算颜色/笔形，
    // 否则画板会变成 archetype 重生成的绿色十字散点，与预览的粉色柔团不一致。
    window.activeVisualParams = visualParams;
    window.activeFusedVisualParams = visualParams;
    window.activeVisualStructure = {
      strokePattern: active.visualParams?.strokePattern,
      motionModel: active.visualParams?.motionModel,
      texturePattern: active.visualParams?.texturePattern
    };
    // 关键：brush 参数与预览用同一套 BrushSchema，避免沿用上一次预览/默认值。
    if (typeof BrushSchema !== "undefined" &&
        typeof BrushSchema.fromVisualAndModifiers === "function") {
      window.activeBrushParams = BrushSchema.fromVisualAndModifiers(
        active.visualParams || {},
        active.styleModifiers || {},
        active.features || {}
      );
    }
    window.activeAcousticFeatures = active.features || null;
    if (window.brushGenerator) {
      if (typeof window.brushGenerator.resetInkColor === "function" &&
          visualParams.palette && visualParams.palette.length) {
        window.brushGenerator.resetInkColor(visualParams.palette[0]);
      }
      if (typeof window.brushGenerator.clear === "function") {
        window.brushGenerator.clear();
      }
    }

    window.activePersonality = active.aiResult?.personality || this.defaultPersonality;
    window.activeAiResult = active.aiResult;
    window.activeAudioFeatures = active.features;
    window.activeAcousticViz = active.acoustic || null;
    window.activeShapeProfile = active.shapeProfile || active.acoustic?.shapeProfile || null;
    window.activeNaturalArchetype = active.pythonAnalysis?.naturalArchetype || null;
    window.activeShapeProfileVersion = window.activeShapeProfile
      ? `${active.id}-plate-${Date.now()}`
      : null;

    if (clearCanvas && this.canvasInteraction) {
      this.canvasInteraction.resetField();
    }
    return active;
  },

  enterPlateStudio() {
    const samples = PlateManager.getSelectedSamples(this);
    if (!samples.length) return;

    const notReady = PlateManager.notBrushReadyNames(this);
    if (notReady.length) {
      alert(`以下录音尚未生成 Brush，请先点 Transform：\n${notReady.join("\n")}`);
      return;
    }

    const brushReady = PlateManager.brushReadySamples(this);
    if (!brushReady.length) {
      alert("所选录音还没有 Brush 参数，请先 Transform 或「分析 → 应用 Brush」。");
      return;
    }

    this.plateMode = true;
    if (!PlateManager.activeBrushId || !PlateManager.isSelected(PlateManager.activeBrushId)) {
      PlateManager.activeBrushId = samples[0].id;
    }

    const shouldClear = !this._plateCanvasInitialized;
    const active = this.applyActiveBrushGlobals(shouldClear);
    if (!active) return;
    this._plateCanvasInitialized = true;

    document.getElementById("libraryView")?.classList.add("hidden");
    document.getElementById("transformView")?.classList.add("hidden");
    document.getElementById("analysisView")?.classList.remove("hidden");

    if (this.transformView) this.transformView.stop();

    this.updatePlateStudioHeader(active, samples.length);
    this.renderBrushStrip();
    this.renderPlateInterpretationPanel(active, samples.length);

    // 必须打开 Figma 画板顶栏；否则 p5 会退回旧 Color Palette / Sound Breathing 布局
    if (window.PikoCanvasScreen && typeof window.PikoCanvasScreen.activate === "function") {
      window.PikoCanvasScreen.activate();
    }

    requestAnimationFrame(() => {
      const holder = document.getElementById("canvasHolder");
      if (holder && typeof resizeCanvas === "function") {
        resizeCanvas(holder.offsetWidth || 880, holder.offsetHeight || 623);
        if (this.canvasInteraction) this.canvasInteraction.resize();
      }
    });
  },

  updatePlateStudioHeader(activeSample, brushCount) {
    const nameEl = document.getElementById("analysisSampleName");
    const metaEl = document.getElementById("analysisMeta");
    if (nameEl) nameEl.textContent = `色盘画板 · ${brushCount} brush`;
    if (metaEl) {
      metaEl.textContent = `当前：${activeSample.name} · 切换上方 brush 用不同声音绘画`;
    }
  },

  renderBrushStrip() {
    const strip = document.getElementById("plateBrushStrip");
    if (!strip) return;

    const samples = PlateManager.getSelectedSamples(this).filter((s) => PlateManager.isBrushReady(s));
    if (!this.plateMode || !samples.length) {
      strip.classList.add("hidden");
      strip.innerHTML = "";
      return;
    }

    strip.classList.remove("hidden");
    strip.innerHTML = samples.map((s) => {
      const active = s.id === PlateManager.activeBrushId;
      const pal = s.visualParams?.palette?.[0];
      const swatch = pal
        ? `background:rgb(${pal.r},${pal.g},${pal.b})`
        : "background:#bbb";
      const pattern = s.visualParams?.strokePattern || "flow_field";
      const reanalyze = `<button type="button" class="brush-strip-reanalyze" onclick="event.stopPropagation();App.openAcousticAnalysis('${s.id}')" title="二次分析">分析</button>`;
      return `<button type="button" class="brush-strip-btn${active ? " active" : ""}" data-brush-id="${s.id}" onclick="App.switchPlateBrush('${s.id}')">
        <span class="brush-strip-swatch" style="${swatch}"></span>
        <span class="brush-strip-name">${s.name}</span>
        <span class="brush-strip-pattern">${pattern.replace(/_/g, " ")}</span>
        ${reanalyze}
      </button>`;
    }).join("");
  },

  switchPlateBrush(sampleId) {
    if (!PlateManager.isSelected(sampleId)) return;
    PlateManager.setActiveBrush(sampleId);
    const active = this.applyActiveBrushGlobals(false);
    if (!active) return;
    const n = PlateManager.getSelectedSamples(this).length;
    this.updatePlateStudioHeader(active, n);
    this.renderBrushStrip();
    this.renderPlateInterpretationPanel(active, n);
  },

  renderPlateInterpretationPanel(activeSample, brushCount) {
    const p = document.getElementById("interpretationPanel");
    if (!p) return;

    const historyN = activeSample.analysisHistory?.length || 0;
    const vp = activeSample.visualParams;
    const paletteSwatches = (vp?.palette || []).map((c) =>
      `<span class="ip-swatch" style="background:rgb(${c.r},${c.g},${c.b})"></span>`
    ).join("");

    p.innerHTML = `
      <div class="ip-content">
        <section class="ip-identity-card">
          <p class="ip-eyebrow">Plate · ${brushCount} brush</p>
          <h3 class="ip-identity-name">${activeSample.name}</h3>
          <p class="ip-interpretation">同一块画板上切换 brush，每段录音保持独立记忆${historyN ? `（已分析 ${historyN} 次）` : ""}。</p>
        </section>
        <section class="ip-summary-block">
          <div class="ip-summary-row">
            <span class="ip-summary-label">当前 Brush</span>
            <p class="ip-summary-text">${vp?.strokePattern || "flow_field"} · ${vp?.motionModel || "organic"}</p>
            <div class="ip-palette-row">${paletteSwatches}</div>
          </div>
          <div class="ip-summary-row">
            <span class="ip-summary-label">二次分析</span>
            <p class="ip-summary-text">可随时对任意 brush 重新「分析」，结果写入该录音记忆，不影响其他段。</p>
            <button class="ip-analyze-btn" onclick="App.openAcousticAnalysis('${activeSample.id}')">重新分析当前 brush</button>
          </div>
        </section>
        <section class="ip-hint">
          <p>左侧呼吸球随当前 brush 变化；中央画板为共享 plate，换 brush 不会清空已画内容。</p>
        </section>
      </div>`;
  },

  bindIntegrationPanel() {
    if (this._integrationBound) return;
    this._integrationBound = true;
    const btn = document.getElementById("integRefreshBtn");
    btn?.addEventListener("click", () => this.serviceConnection?.tick());
    this.serviceConnection?.tick();
  },

  async refreshIntegrationStatus() {
    await this.serviceConnection?.tick();
  },

  bindUploadModal() {
    const modal = document.getElementById("uploadModal");
    const openBtn = document.getElementById("openUploadModalBtn");
    const closeBtn = document.getElementById("closeUploadModalBtn");
    const backdrop = document.getElementById("uploadModalBackdrop");
    const zone = document.getElementById("uploadZone");
    const input = document.getElementById("audioFileInput");
    const browseBtn = document.getElementById("uploadBrowseBtn");
    const statusEl = document.getElementById("uploadStatus");

    if (!modal || !openBtn || !zone || !input) return;

    const setStatus = (text, isError = false) => {
      if (!statusEl) return;
      statusEl.textContent = text || "";
      statusEl.classList.toggle("is-error", isError);
    };

    const openModal = () => {
      modal.classList.remove("hidden");
      setStatus("");
      zone.classList.remove("drag-over");
    };

    const closeModal = () => {
      modal.classList.add("hidden");
      zone.classList.remove("drag-over");
      input.value = "";
    };

    const handleFiles = async (fileList) => {
      const file = fileList && fileList[0];
      if (!file) return;

      if (!file.type.startsWith("audio/") && !/\.(wav|mp3|m4a|ogg|flac|aac|webm)$/i.test(file.name)) {
        setStatus("请选择有效的音频文件。", true);
        return;
      }

      setStatus("正在导入…");
      const sample = await this.addFile(file, { source: "import" });
      if (!sample) {
        setStatus("无法解码该音频，请换另一个文件。", true);
        return;
      }

      setStatus(`已导入「${sample.name}」，正在进入 Transform…`);
      closeModal();
      this.enterTransformView(sample.id);
    };

    openBtn.addEventListener("click", openModal);
    closeBtn?.addEventListener("click", closeModal);
    backdrop?.addEventListener("click", closeModal);

    browseBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      input.click();
    });

    zone.addEventListener("click", () => input.click());

    input.addEventListener("change", () => {
      handleFiles(input.files);
    });

    zone.addEventListener("dragover", (e) => {
      e.preventDefault();
      zone.classList.add("drag-over");
    });

    zone.addEventListener("dragleave", () => {
      zone.classList.remove("drag-over");
    });

    zone.addEventListener("drop", (e) => {
      e.preventDefault();
      zone.classList.remove("drag-over");
      handleFiles(e.dataTransfer?.files);
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !modal.classList.contains("hidden")) {
        closeModal();
      }
    });
  },

  async addFile(file, options = {}) {
    let waveformSnapshot, duration;
    try {
      const arrayBuffer = await file.arrayBuffer();
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      let buf;
      try {
        buf = await ctx.decodeAudioData(arrayBuffer);
      } finally {
        ctx.close().catch(() => {});
      }
      duration = buf.duration;

      const ch = buf.getChannelData(0);
      waveformSnapshot = new Float32Array(200);
      for (let i = 0; i < 200; i++) {
        waveformSnapshot[i] = ch[Math.floor(i * ch.length / 200)];
      }
    } catch (err) {
      console.warn("Could not decode", file.name, err);
      return;
    }

    const baseName = options.displayName || file.name.replace(/\.[^.]+$/, "");
    const sample = {
      id: options.backendId || ("s" + Date.now() + Math.random().toString(36).slice(2)),
      backendId: options.backendId || null,
      name: baseName,
      fileName: file.name,
      file,
      duration,
      waveformSnapshot,
      features: null,
      aiResult: null,
      visualParams: null,
      acoustic: null,
      shapeProfile: null,
      status: "ready",
      source: options.source || "import",
      esp32MetricsSeries: options.esp32MetricsSeries || null,
      esp32UsedPcm: !!options.esp32UsedPcm,
      analysisHistory: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    // Avoid duplicate backend sounds
    if (options.backendId) {
      const dup = this.soundLibrary.find((s) => s.backendId === options.backendId || s.id === options.backendId);
      if (dup) return dup;
    }

    this.soundLibrary.unshift(sample);
    this.persistSample(sample);
    this.renderLibrary();
    this.renderPlatePanel();
    return sample;
  },

  async analyzeSample(sampleId) {
    this.enterTransformView(sampleId);
  },

  async openAcousticAnalysis(sampleId) {
    const sample = this.soundLibrary.find((s) => s.id === sampleId);
    if (!sample || !window.acousticAnalysisWindow) return;
    await window.acousticAnalysisWindow.analyzeAndShow(sample.file, sample.fileName, {
      sampleName: sample.name,
      duration: sample.duration,
      sampleId: sample.id
    });
  },

  enterTransformView(sampleId) {
    const sample = this.soundLibrary.find(s => s.id === sampleId);
    if (!sample) return;
    this.selectedSampleId = sampleId;
    // 无旧 Transform 界面：静默跑 analysis 管线
    if (this.transformView) this.transformView.start(sample);
  },

  enterAnalysisView(sampleId) {
    if (this.plateMode && PlateManager.isSelected(sampleId)) {
      this.switchPlateBrush(sampleId);
      return;
    }

    const sample = this.soundLibrary.find(s => s.id === sampleId);
    if (!sample) return;
    this.plateMode = false;
    this.selectedSampleId = sampleId;

    document.getElementById("plateBrushStrip")?.classList.add("hidden");

    if (this.transformView) this.transformView.stop();

    document.getElementById("libraryView")?.classList.add("hidden");
    document.getElementById("transformView")?.classList.add("hidden");
    document.getElementById("analysisView")?.classList.remove("hidden");

    this.updateAnalysisHeader(sample);

    if (sample.status === "analyzed") {
      window.activeVisualParams = sample.visualParams;
      if (sample.pythonAnalysis && typeof NaturalSoundArchetypes !== "undefined") {
        NaturalSoundArchetypes.applyFromFeatures({
          analysisExport: sample.pythonAnalysis,
          features: sample.features
        });
        window.activeVisualParams = window.activeFusedVisualParams || window.activeVisualParams;
      }
      window.activePersonality = sample.aiResult.personality;
      window.activeAiResult = sample.aiResult;
      window.activeAudioFeatures = sample.features;
      window.activeAcousticViz = sample.acoustic || null;
      window.activeShapeProfile = sample.shapeProfile || sample.acoustic?.shapeProfile || null;
      window.activeNaturalArchetype = sample.pythonAnalysis?.naturalArchetype || window.activeNaturalArchetype || null;
      window.activeShapeProfileVersion = window.activeShapeProfile ? `${sample.id}-analysis-${Date.now()}` : null;
      console.group("[Sound Shape Analysis]");
      console.log("sampleId:", sample.id);
      console.log("naturalArchetype:", window.activeNaturalArchetype);
      console.table(window.activeShapeProfile || {});
      console.groupEnd();
      if (this.canvasInteraction) this.canvasInteraction.resetField();
      this.renderInterpretationPanel(sample);
    } else {
      this.showReadyState(sample);
    }

    requestAnimationFrame(() => {
      const holder = document.getElementById("canvasHolder");
      if (holder && typeof resizeCanvas === "function") {
        resizeCanvas(holder.offsetWidth || 600, holder.offsetHeight || 500);
        if (this.canvasInteraction) this.canvasInteraction.resize();
      }
    });
  },

  enterLibraryView() {
    if (this.transformView) this.transformView.stop();
    this.plateMode = false;
    document.getElementById("plateBrushStrip")?.classList.add("hidden");
    document.getElementById("analysisView")?.classList.add("hidden");
    document.getElementById("transformView")?.classList.add("hidden");
    this.selectedSampleId = null;
    if (this.visualMappingEngine) {
      window.activeVisualParams = this.visualMappingEngine.compute(this.defaultPersonality);
      window.activePersonality = { ...this.defaultPersonality };
      window.activeAiResult = null;
      window.activeAudioFeatures = null;
      window.activeAcousticViz = null;
      window.activeShapeProfile = null;
      window.activeNaturalArchetype = null;
      window.activeShapeProfileVersion = null;
      window.pythonAcousticViz = null;
      this.canvasInteraction?.leftField?.clearShapeProfile?.();
    }
    this.renderLibrary();
    if (window.PikoRouter) window.PikoRouter.show("sounds", { mode: "none" });
  },

  updateAnalysisHeader(sample) {
    const nameEl = document.getElementById("analysisSampleName");
    const metaEl = document.getElementById("analysisMeta");
    if (nameEl) {
      nameEl.textContent = sample.aiResult?.identity?.name || sample.name;
    }
    if (metaEl) metaEl.textContent = this.formatDuration(sample.duration) + " · " + sample.fileName;
  },

  showAnalyzingState() {
    const p = document.getElementById("interpretationPanel");
    if (!p) return;
    p.innerHTML = `<div class="ip-loading">
      <div class="ip-spinner"></div>
      <p>Listening to your sound…</p>
      <p class="ip-loading-sub">Turning it into living visual material.</p>
    </div>`;
  },

  showReadyState(sample) {
    const p = document.getElementById("interpretationPanel");
    if (!p) return;
    p.innerHTML = `<div class="ip-ready">
      <div class="ip-ready-icon">♪</div>
      <p class="ip-ready-label">Ready to transform</p>
      <p class="ip-ready-sub">${sample.name} is waiting to become a drawing material.</p>
      <button class="ip-analyze-btn" onclick="App.analyzeSample('${sample.id}')">
        Turn Sound Into Material
      </button>
    </div>`;
  },

  renderInterpretationPanel(sample) {
    const p = document.getElementById("interpretationPanel");
    if (!p || !sample.aiResult) return;

    const id = sample.aiResult.identity;
    const vp = sample.visualParams;
    const paletteSwatches = (vp.palette || []).map(c =>
      `<span class="ip-swatch" style="background:rgb(${c.r},${c.g},${c.b})" title="Generated color"></span>`
    ).join("");

    p.innerHTML = `
      <div class="ip-content">
        <section class="ip-identity-card">
          <p class="ip-eyebrow">Sound Identity</p>
          <h3 class="ip-identity-name">${id.name}</h3>
          <p class="ip-interpretation">${id.interpretation}</p>
        </section>

        <section class="ip-summary-block">
          <div class="ip-summary-row">
            <span class="ip-summary-label">Personality</span>
            <p class="ip-summary-text">${id.personalitySummary}</p>
          </div>
          <div class="ip-summary-row">
            <span class="ip-summary-label">Structure</span>
            <p class="ip-summary-text">${id.structureSummary}</p>
          </div>
          <div class="ip-summary-row">
            <span class="ip-summary-label">Temporal Memory</span>
            <p class="ip-summary-text">${id.temporalSummary}</p>
            <div class="ip-temporal-arc" aria-hidden="true">
              <span class="ip-arc-node ip-arc-begin">beginning</span>
              <span class="ip-arc-line"></span>
              <span class="ip-arc-node ip-arc-mid">middle</span>
              <span class="ip-arc-line"></span>
              <span class="ip-arc-node ip-arc-end">end</span>
            </div>
          </div>
          <div class="ip-summary-row">
            <span class="ip-summary-label">Generated Material</span>
            <p class="ip-summary-text">${id.materialSummary}</p>
            <div class="ip-palette-row">${paletteSwatches}</div>
          </div>
        </section>

        <section class="ip-hint">
          <p>The side forms breathe with your sound's memory. Draw in the centre with the material above.</p>
        </section>
      </div>
    `;

    this.updateAnalysisHeader(sample);
  },

  renderLibrary() {
    const container = document.getElementById("libraryCards");
    const countEl = document.getElementById("libraryCount");
    if (!container) return;

    if (countEl) {
      countEl.textContent = this.soundLibrary.length
        ? "(" + this.soundLibrary.length + ")"
        : "";
    }

    if (this.soundLibrary.length === 0) {
      container.innerHTML = `<p class="lib-empty">No sounds yet. Tap <strong>Start recording</strong> above to capture your first discovery.</p>`;
      return;
    }

    const statusLabel = { ready: "Ready", analyzing: "Transforming…", analyzed: "Material ready" };
    const onPlate = (id) => PlateManager.isSelected(id);
    const historyBadge = (s) => {
      const n = s.analysisHistory?.length || 0;
      return n > 0 ? `<span class="lib-history-tag" title="分析记录">${n}×</span>` : "";
    };

    container.innerHTML = this.soundLibrary.map(s => {
      const identityName = s.aiResult?.identity?.name;
      const displayName = identityName || s.name;
      const sourceTag = s.source === "esp32-record" || s.source === "field-record"
        ? `<span class="lib-source-tag">esp32</span>`
        : "";
      const analyzeBtn = s.status !== "analyzing"
        ? `<button class="lib-btn lib-btn-acoustic" onclick="event.stopPropagation(); App.openAcousticAnalysis('${s.id}')" title="声学分析（可多次）">分析</button>
           <button class="lib-btn" onclick="event.stopPropagation(); App.enterTransformView('${s.id}')" title="Transform">Transform</button>`
        : "";
      const paletteHint = s.visualParams?.palette?.[0];
      const accentStyle = paletteHint
        ? `style="border-left:3px solid rgb(${paletteHint.r},${paletteHint.g},${paletteHint.b})"`
        : "";
      const brushReady = PlateManager.isBrushReady(s);

      return `<div class="lib-card${onPlate(s.id) ? " on-plate" : ""}" ${accentStyle}>
        <button type="button" class="lib-plate-btn${onPlate(s.id) ? " is-on" : ""}${brushReady ? "" : " is-pending"}"
          onclick="event.stopPropagation(); App.togglePlateSelection('${s.id}')"
          title="${onPlate(s.id) ? "移出画板" : "加入画板"}">
          ${onPlate(s.id) ? "✓ 画板" : "＋ 画板"}
        </button>
        <div class="lib-card-top">
          <span class="lib-name" title="${s.fileName}">${displayName}</span>${sourceTag}${historyBadge(s)}
          <span class="lib-dur">${this.formatDuration(s.duration)}</span>
        </div>
        <canvas class="lib-wave" id="lw-${s.id}" width="180" height="32"></canvas>
        <div class="lib-card-bot">
          <span class="lib-status status-${s.status}">${statusLabel[s.status] || s.status}</span>
          <div class="lib-actions">
            <button class="lib-btn lib-btn-icon" data-play-id="${s.id}" onclick="event.stopPropagation(); App.togglePlaySample('${s.id}')" title="Play">
              <svg class="icon-play" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>
              <svg class="icon-pause hidden" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
            </button>
            ${analyzeBtn}
            <button class="lib-btn lib-btn-del" onclick="event.stopPropagation(); App.deleteSample('${s.id}')" title="Delete">×</button>
          </div>
        </div>
      </div>`;
    }).join("");

    this.soundLibrary.forEach(s => {
      const cvs = document.getElementById("lw-" + s.id);
      if (cvs && s.waveformSnapshot && s.waveformSnapshot.length > 0) {
        this.drawMiniWaveform(cvs, s.waveformSnapshot, s.visualParams?.palette?.[0]);
      }
    });
  },

  drawMiniWaveform(canvas, data, accent, progress) {
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;
    const mid = h / 2;
    const color = accent ? `rgb(${accent.r},${accent.g},${accent.b})` : "#F16E1C";
    const muted = "rgba(241, 110, 28, 0.28)";
    const p = Math.max(0, Math.min(1, progress == null ? 1 : progress));
    const split = Math.round(w * p);

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);

    const strokeWave = (fromX, toX, stroke) => {
      if (toX <= fromX) return;
      ctx.beginPath();
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1.4;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      for (let i = fromX; i < toX; i++) {
        const idx = Math.min(Math.floor(i * data.length / w), data.length - 1);
        const y = mid + data[idx] * mid * 0.82;
        if (i === fromX) ctx.moveTo(i, y);
        else ctx.lineTo(i, y);
      }
      ctx.stroke();
    };

    // 未播：淡色；已播：实色（progress 省略时整段实色）
    if (progress == null) {
      strokeWave(0, w, color);
    } else {
      strokeWave(0, split, color);
      strokeWave(split, w, muted);
      if (p > 0 && p < 1) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(split + 0.5, 4);
        ctx.lineTo(split + 0.5, h - 4);
        ctx.stroke();
      }
    }
  },

  setPlayButtonState(sampleId, playing) {
    document.querySelectorAll(`[data-play-id="${sampleId}"]`).forEach((btn) => {
      btn.classList.toggle("is-playing", playing);
      btn.querySelector(".icon-play")?.classList.toggle("hidden", playing);
      btn.querySelector(".icon-pause")?.classList.toggle("hidden", !playing);
      btn.title = playing ? "Pause" : "Play";
      btn.setAttribute("aria-label", playing ? "暂停" : "播放");
    });
  },

  /** mm:ss，含 0 → 00:00（列表时长用，不要走 formatDuration 的 --:--） */
  _fmtClock(secs) {
    const total = Math.max(0, Math.floor(Number(secs) || 0));
    const m = String(Math.floor(total / 60)).padStart(2, "0");
    const s = String(total % 60).padStart(2, "0");
    return `${m}:${s}`;
  },

  /**
   * 播放中：时长从 00:00 往上走；传 null 则回到该 sample 的总时长。
   * 覆盖 brush 列表、sounds 卡片、brush 信息栏。
   */
  _updatePlaybackTimeLabels(sampleId, elapsedOrNull) {
    const sample = this.soundLibrary.find((s) => s.id === sampleId);
    const text = elapsedOrNull == null
      ? this._fmtClock(sample?.duration)
      : this._fmtClock(elapsedOrNull);

    document.querySelectorAll(`[data-play-id="${sampleId}"]`).forEach((btn) => {
      const row = btn.closest(".brush-row, .sound-card");
      if (!row) return;
      const durEl = row.querySelector(".brush-row-dur, .sound-dur");
      if (durEl) durEl.textContent = text;
    });

    const infoDur = document.getElementById("brushInfoDur");
    if (infoDur && window.PikoBrushScreen) {
      // 信息栏只跟着当前选中笔刷走
      const activeRow = document.querySelector(".brush-row.is-active [data-play-id]");
      if (activeRow && activeRow.dataset.playId === sampleId) {
        infoDur.textContent = text;
      }
    }
  },

  _paintPlaybackWaveforms(sampleId, progress) {
    const sample = this.soundLibrary.find((s) => s.id === sampleId);
    if (!sample?.waveformSnapshot?.length) return;
    const accent = sample.visualParams?.palette?.[0] || { r: 241, g: 110, b: 28 };
    ["pw-", "lw-", "bw-"].forEach((prefix) => {
      const cvs = document.getElementById(prefix + sampleId);
      if (cvs) this.drawMiniWaveform(cvs, sample.waveformSnapshot, accent, progress);
    });
  },

  _stopPlaybackScrubber() {
    if (this._scrubRaf != null) {
      cancelAnimationFrame(this._scrubRaf);
      this._scrubRaf = null;
    }
  },

  _startPlaybackScrubber() {
    this._stopPlaybackScrubber();
    const tick = () => {
      const audio = this.playbackAudio;
      const id = this.playbackSampleId;
      if (!audio || !id || audio.paused) {
        this._scrubRaf = null;
        return;
      }
      const dur = audio.duration;
      const t = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
      const p = Number.isFinite(dur) && dur > 0 ? t / dur : 0;
      this._paintPlaybackWaveforms(id, p);
      this._updatePlaybackTimeLabels(id, t);
      this._scrubRaf = requestAnimationFrame(tick);
    };
    this._scrubRaf = requestAnimationFrame(tick);
  },

  stopPlayback() {
    this._stopPlaybackScrubber();
    const endedId = this.playbackSampleId;
    if (this.playbackAudio) {
      this.playbackAudio.pause();
      this.playbackAudio.onended = null;
      this.playbackAudio = null;
    }
    if (this.playbackSource) {
      try { this.playbackSource.disconnect(); } catch (e) { /* noop */ }
      this.playbackSource = null;
    }
    if (this.playbackUrl) {
      URL.revokeObjectURL(this.playbackUrl);
      this.playbackUrl = null;
    }
    if (endedId) {
      this.setPlayButtonState(endedId, false);
      this._paintPlaybackWaveforms(endedId, null);
      this._updatePlaybackTimeLabels(endedId, null);
      this.playbackSampleId = null;
    }
  },

  _ensurePlaybackAudioGraph() {
    if (this.playbackAudioCtx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    this.playbackAudioCtx = new Ctx();
    this.playbackAnalyser = this.playbackAudioCtx.createAnalyser();
    this.playbackAnalyser.fftSize = 2048;
    this.playbackAnalyser.smoothingTimeConstant = 0.48;
    this.playbackGain = this.playbackAudioCtx.createGain();
    this.playbackGain.gain.value = 1;
    this.playbackAnalyser.connect(this.playbackGain);
    this.playbackGain.connect(this.playbackAudioCtx.destination);
  },

  _bindPlaybackAnalyser(audioEl) {
    if (!audioEl) return;
    this._ensurePlaybackAudioGraph();
    if (!this.playbackAudioCtx || !this.playbackAnalyser) return;

    if (this.playbackSource) {
      try { this.playbackSource.disconnect(); } catch (e) { /* noop */ }
      this.playbackSource = null;
    }

    try {
      this.playbackSource = this.playbackAudioCtx.createMediaElementSource(audioEl);
      this.playbackSource.connect(this.playbackAnalyser);
    } catch (err) {
      console.warn("Playback analyser bind failed:", err);
    }
  },

  _resumePlaybackAudioCtx() {
    if (this.playbackAudioCtx && this.playbackAudioCtx.state === "suspended") {
      return this.playbackAudioCtx.resume();
    }
    return Promise.resolve();
  },

  togglePlaySample(sampleId) {
    const sample = this.soundLibrary.find(s => s.id === sampleId);
    if (!sample) return;

    if (this.playbackSampleId === sampleId && this.playbackAudio && !this.playbackAudio.paused) {
      this.playbackAudio.pause();
      this._stopPlaybackScrubber();
      this.setPlayButtonState(sampleId, false);
      // 暂停时保留已播到的时间，不跳回总时长
      this._updatePlaybackTimeLabels(sampleId, this.playbackAudio.currentTime || 0);
      return;
    }

    if (this.playbackSampleId === sampleId && this.playbackAudio?.paused) {
      this._resumePlaybackAudioCtx();
      // 从暂停点继续；若用户期望每次都从 0，在下方「新开播放」路径已保证
      this._updatePlaybackTimeLabels(sampleId, this.playbackAudio.currentTime || 0);
      this.playbackAudio.play()
        .then(() => {
          this.setPlayButtonState(sampleId, true);
          this._startPlaybackScrubber();
        })
        .catch(e => console.warn("Playback error:", e));
      return;
    }

    this.stopPlayback();
    this.playbackUrl = URL.createObjectURL(sample.file);
    const audio = new Audio(this.playbackUrl);
    audio.crossOrigin = "anonymous";
    audio.currentTime = 0;
    this.playbackAudio = audio;
    this.playbackSampleId = sampleId;
    this._bindPlaybackAnalyser(audio);
    this._updatePlaybackTimeLabels(sampleId, 0);
    audio.onended = () => this.stopPlayback();
    this._resumePlaybackAudioCtx()
      .then(() => audio.play())
      .then(() => {
        this.setPlayButtonState(sampleId, true);
        this._startPlaybackScrubber();
        if (window.activeAudioFeatures !== sample.features && sample.features) {
          window.activeAudioFeatures = sample.features;
        }
      })
      .catch(e => console.warn("Playback error:", e));
  },

  playSample(sampleId) {
    this.togglePlaySample(sampleId);
  },

  deleteSample(sampleId) {
    const idx = this.soundLibrary.findIndex(s => s.id === sampleId);
    if (idx === -1) return;
    this.soundLibrary.splice(idx, 1);
    PlateManager.remove(this, sampleId);
    if (typeof SampleLibraryStore !== "undefined") {
      SampleLibraryStore.deleteSample(sampleId);
    }

    if (this.selectedSampleId === sampleId) {
      this.enterLibraryView();
    } else {
      this.renderLibrary();
      this.renderPlatePanel();
    }
  },

  formatDuration(secs) {
    if (!secs || isNaN(secs)) return "--:--";
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return m + ":" + String(s).padStart(2, "0");
  }
};

window.App = App;

(function bootServicesEarly() {
  const run = () => App.bootstrapServices();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run);
  } else {
    run();
  }
})();
