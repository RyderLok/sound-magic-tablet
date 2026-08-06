// Field recorder — ESP32 hardware stream only (no computer microphone).
class FieldRecorder {
  static MAX_DURATION_SEC = 20;

  constructor(app) {
    this.app = app;
    this.recording = false;
    this.metricsBuffer = [];
    this.pcmChunks = [];
    this.startTime = null;
    this.lastSampleAt = 0;
    this.meterFrame = null;
    this.pendingBlob = null;
    this.pendingDuration = 0;
    this.recordCounter = 0;
    this.lastMeterLevel = 0;
    this.usedPcmPath = false;
    this.pcmByteTotal = 0;
    this.savedMetricsSeries = [];
    this.previewAudio = null;
    this.previewUrl = null;
    this.previewPlaying = false;
    this._stoppingForLimit = false;
  }

  bindElements() {
    this.els = {
      zone: document.getElementById("recordZone"),
      startBtn: document.getElementById("recordStartBtn"),
      stopBtn: document.getElementById("recordStopBtn"),
      timer: document.getElementById("recordTimer"),
      hint: document.getElementById("recordHint"),
      meter: document.getElementById("recordMeterCanvas"),
      idlePanel: document.getElementById("recordIdlePanel"),
      activePanel: document.getElementById("recordActivePanel"),
      savePanel: document.getElementById("recordSavePanel"),
      saveSummary: document.getElementById("recordSaveSummary"),
      pointCount: document.getElementById("recordPointCount"),
      nameInput: document.getElementById("recordNameInput"),
      saveBtn: document.getElementById("recordSaveBtn"),
      discardBtn: document.getElementById("recordDiscardBtn"),
      previewBtn: document.getElementById("recordPreviewBtn")
    };

    if (this.els.startBtn && !this.els.startBtn.dataset.bound) {
      this.els.startBtn.dataset.bound = "1";
      this.els.startBtn.addEventListener("click", () => this.start());
    }
    if (this.els.stopBtn && !this.els.stopBtn.dataset.bound) {
      this.els.stopBtn.dataset.bound = "1";
      this.els.stopBtn.addEventListener("click", () => this.stop());
    }
    if (this.els.saveBtn && !this.els.saveBtn.dataset.bound) {
      this.els.saveBtn.dataset.bound = "1";
      this.els.saveBtn.addEventListener("click", () => this.savePending());
    }
    if (this.els.discardBtn && !this.els.discardBtn.dataset.bound) {
      this.els.discardBtn.dataset.bound = "1";
      this.els.discardBtn.addEventListener("click", () => this.discardPending());
    }
    if (this.els.previewBtn && !this.els.previewBtn.dataset.bound) {
      this.els.previewBtn.dataset.bound = "1";
      this.els.previewBtn.addEventListener("click", () => this.togglePreview());
    }

    this.bindHardwareButton();
  }

  /** Keyes button on ESP32 → same Start/Stop as the web UI */
  bindHardwareButton() {
    const esp = this.getAdapter();
    if (!esp) return;
    // Always re-bind so reconnect / late adapter init still wires Keyes → UI
    esp.onHardwareRecord = (evt) => {
      if (!evt) return;
      if (evt.status === "started") {
        this.start({ skipSerialCommand: true, fromHardware: true });
      } else if (evt.status === "stopped") {
        this.stop({ skipSerialCommand: true, fromHardware: true, autoSave: true });
      }
    };
    // If Keyes skips rec_start JSON and only streams PCM, first frame still arms UI
    esp.onPcmArmRecording = () => {
      if (!this.recording) {
        this.start({ skipSerialCommand: true, fromHardware: true });
      }
    };
    // Bridge finished upload to Piko backend — pull that sound into the library
    esp.onSession = (evt) => {
      if (!evt || evt.status !== "uploaded" || !evt.soundId) return;
      const client = window.SoundsApiClient;
      if (!client || !this.app) return;
      client.syncIntoApp(this.app)
        .then((result) => {
          if (result && result.importedIds && result.importedIds.length) {
            if (typeof client.appendLatestBatch === "function") {
              client.appendLatestBatch(result.importedIds);
            } else if (typeof client.commitTransferBatch === "function") {
              client.commitTransferBatch(this.app, result);
            }
          }
          if (window.PikoSoundsScreen && typeof window.PikoSoundsScreen.render === "function") {
            window.PikoSoundsScreen.render();
          }
          if (typeof this.app.renderLibrary === "function") this.app.renderLibrary();
        })
        .catch((err) => {
          console.warn("[record] post-upload sync failed:", err);
        });
    };
  }

  setPreviewPlaying(playing) {
    this.previewPlaying = playing;
    const btn = this.els.previewBtn;
    if (!btn) return;
    btn.classList.toggle("is-playing", playing);
    btn.querySelector(".icon-play")?.classList.toggle("hidden", playing);
    btn.querySelector(".icon-pause")?.classList.toggle("hidden", !playing);
    btn.title = playing ? "暂停试听" : "试听录音";
    btn.setAttribute("aria-label", playing ? "Pause preview" : "Play preview");
  }

  stopPreview() {
    if (this.previewAudio) {
      this.previewAudio.pause();
      this.previewAudio.onended = null;
      this.previewAudio = null;
    }
    if (this.previewUrl) {
      URL.revokeObjectURL(this.previewUrl);
      this.previewUrl = null;
    }
    this.setPreviewPlaying(false);
  }

  togglePreview() {
    if (!this.pendingBlob) return;

    if (this.previewPlaying && this.previewAudio) {
      this.previewAudio.pause();
      this.setPreviewPlaying(false);
      return;
    }

    if (this.previewAudio) {
      this.previewAudio.play().catch(() => {});
      this.setPreviewPlaying(true);
      return;
    }

    this.previewUrl = URL.createObjectURL(this.pendingBlob);
    const audio = new Audio(this.previewUrl);
    this.previewAudio = audio;
    audio.onended = () => this.setPreviewPlaying(false);
    audio.play()
      .then(() => this.setPreviewPlaying(true))
      .catch(() => {
        alert("无法播放试听，请再点一次播放按钮。");
        this.stopPreview();
      });
  }

  setPanel(mode) {
    this.els.idlePanel?.classList.toggle("hidden", mode !== "idle");
    this.els.activePanel?.classList.toggle("hidden", mode !== "active");
    this.els.savePanel?.classList.toggle("hidden", mode !== "save");
    this.els.zone?.classList.toggle("is-recording", mode === "active");
    this.els.zone?.classList.toggle("is-save-ready", mode === "save");
    if (mode !== "save") this.stopPreview();
  }

  getAdapter() {
    return window.esp32AudioAdapter;
  }

  defaultName() {
    this.recordCounter += 1;
    return `Field sound ${this.recordCounter}`;
  }

  wifiFirstMode() {
    return !!(window.PikoServiceEndpoints && window.PikoServiceEndpoints.isWifiFirstMode
      && window.PikoServiceEndpoints.isWifiFirstMode());
  }

  hardwareErrorMessage() {
    return (
      "INMP441 硬件未就绪。\n\n" +
      "请确认：\n" +
      "1. 已烧录最新 esp32/inmp441_bridge.ino（含 /metrics）\n" +
      "2. USB：Bridge 在跑；或 Wi‑Fi：ESP32 已连热点并 announce 到 Python\n" +
      "3. 页面上方电平条在动（USB 或 Wi‑Fi Live）\n" +
      "4. 可选 ?esp32=http://<ESP-IP>:8080"
    );
  }

  serialErrorMessage() {
    if (this.wifiFirstMode()) {
      return this.hardwareErrorMessage();
    }
    return (
      "ESP32 串口未打开，INMP441 无法收音。\n\n" +
      "请关闭 Arduino 串口监视器，确认 USB 已插入，然后重启 Bridge。\n" +
      "若只用 Wi‑Fi：在设备上按键录音，页面将从 Python 同步。"
    );
  }

  /** Bridge WS open + serial open, OR Wi‑Fi metrics live. */
  isInmp441Ready(esp) {
    if (!esp) return false;
    if (typeof esp.isHardwareReady === "function" && esp.isHardwareReady()) return true;
    if (typeof esp.isWifiLive === "function" && esp.isWifiLive()) return true;
    if (!esp?.isWsOpen()) return false;
    if (esp.serialOpen === false) return false;
    return true;
  }

  usesWifiTransport(esp) {
    const a = esp || this.getAdapter();
    if (!a) return false;
    if (typeof a.isUsbLive === "function" && a.isUsbLive()) return false;
    return !!(typeof a.isWifiLive === "function" && a.isWifiLive())
      || !!(a.wifiMode)
      || !!this.esp32HttpBase();
  }

  /** Wi‑Fi control plane: ESP32 HTTP /record/* when configured. */
  esp32HttpBase() {
    if (window.PikoServiceEndpoints && typeof window.PikoServiceEndpoints.resolveEsp32HttpBase === "function") {
      return window.PikoServiceEndpoints.resolveEsp32HttpBase();
    }
    return "";
  }

  async startViaEsp32Http() {
    const esp = this.getAdapter();
    if (esp && typeof esp.sendWifiCommand === "function") {
      try {
        await esp.sendWifiCommand("record_start");
        return true;
      } catch (err) {
        console.warn("[record] Wi‑Fi start via adapter failed:", err);
      }
    }
    const base = this.esp32HttpBase();
    if (!base) return false;
    try {
      const res = await fetch(base.replace(/\/$/, "") + "/record/start", { method: "POST" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      return true;
    } catch (err) {
      console.warn("[record] ESP32 HTTP start failed:", err);
      return false;
    }
  }

  pushMetricSample(force) {
    const esp = this.getAdapter();
    if (!esp) return;
    const now = Date.now();
    if (!force && now - this.lastSampleAt < 60) return;

    const n = esp.getNormalized();
    const pct = esp.audioData?.volumePct;
    const level = pct !== undefined
      ? Math.min(1, Number(pct) / 100)
      : Math.max(n.level, this.lastMeterLevel);
    this.metricsBuffer.push({
      t: now,
      level,
      peak: Math.max(n.peak, level),
      volumePct: pct
    });
    this.lastSampleAt = now;
    this.lastMeterLevel = Math.max(this.lastMeterLevel, n.level);
  }

  async start(options = {}) {
    if (this.recording) return;
    this.bindElements();

    const esp = this.getAdapter();
    if (!options.fromHardware) {
      if (!this.isInmp441Ready(esp) && esp?.ensureWifiTransport) {
        await esp.ensureWifiTransport();
      }
      if (!this.isInmp441Ready(esp)) {
        alert(
          esp?.isWsOpen() && esp.serialOpen === false
            ? this.serialErrorMessage()
            : this.hardwareErrorMessage()
        );
        return;
      }
    } else if (!esp?.isWsOpen() && !this.usesWifiTransport(esp)) {
      return;
    }

    this._wifiSession = this.usesWifiTransport(esp)
      && !(esp && typeof esp.isUsbLive === "function" && esp.isUsbLive());

    esp?.resetRecordingCalibration?.();
    this.metricsBuffer = [];
    this.pcmChunks = [];
    this.recording = true;
    this._stoppingForLimit = false;
    this.startTime = Date.now();
    this.lastSampleAt = 0;
    this.usedPcmPath = false;
    this.pcmByteTotal = 0;

    if (!options.skipSerialCommand) {
      try {
        if (this._wifiSession) {
          await esp.sendCommand("record_start");
        } else if (esp?.isWsOpen?.()) {
          await esp.sendCommand("record_start");
        }
      } catch (err) {
        console.warn("[record] REC_START skipped:", err.message || err);
      }
    }

    esp.onMetrics = (m) => {
      if (!this.recording) return;
      const level = m.volumePct !== undefined
        ? Math.min(1, Number(m.volumePct) / 100)
        : Math.max(m.levelNorm || 0, this.lastMeterLevel);
      const peak = Math.max(m.peakNorm || 0, level);
      this.metricsBuffer.push({
        t: m.timestamp || Date.now(),
        level,
        peak,
        volumePct: m.volumePct
      });
      this.lastMeterLevel = level;
      if (this.els.pointCount) {
        if (this._wifiSession) {
          this.els.pointCount.textContent =
            `INMP441 Wi‑Fi · 音量 ${Math.round(level * 100)}%`;
        } else {
          const pcmKb = (this.pcmByteTotal / 1024).toFixed(1);
          this.els.pointCount.textContent =
            `INMP441 PCM：${pcmKb} KB · 音量 ${Math.round(level * 100)}%`;
        }
      }
    };

    esp.onPcmFrame = (bytes) => {
      if (!this.recording || this._wifiSession) return;
      this.pcmChunks.push(bytes);
      this.pcmByteTotal += bytes.length;
      this.lastMeterLevel = pcmLevelFromBytes(bytes);
      this.pushMetricSample(true);
      if (this.els.pointCount) {
        const pcmKb = (this.pcmByteTotal / 1024).toFixed(1);
        this.els.pointCount.textContent =
          `INMP441 PCM：${pcmKb} KB · 帧 ${this.pcmChunks.length}`;
      }
    };

    const pipe = document.getElementById("pipelineStatus");
    if (pipe) {
      pipe.dataset.state = "recording";
      pipe.textContent = this._wifiSession ? "Recording · Wi‑Fi" : "Recording";
    }

    this.pushMetricSample(true);
    this.setPanel("active");
    if (this.els.timer) {
      this.els.timer.textContent = `0.0 / ${FieldRecorder.MAX_DURATION_SEC}s`;
      this.els.timer.classList.remove("is-near-limit");
    }
    if (this.els.hint) {
      const maxLabel = `最长 ${FieldRecorder.MAX_DURATION_SEC}s`;
      this.els.hint.textContent = this._wifiSession
        ? `Wi‑Fi 录音中… 实时波形来自设备。${maxLabel}，点 Stop 结束并上传。`
        : options.fromHardware
          ? `INMP441 录音中… ${maxLabel}，再按 Keyes 或点 Stop 结束。`
          : `INMP441 录音中… ${maxLabel}，点 Stop 结束（不用电脑麦克风）。`;
    }
    this.startMeterLoop();
  }

  ensureMetricsBuffer(duration) {
    if (this.metricsBuffer.length >= 2) return;

    const level = this.lastMeterLevel || 0.08;
    const t0 = this.startTime;
    const t1 = Date.now();
    this.metricsBuffer = [
      { t: t0, level, peak: level },
      { t: t1, level, peak: level }
    ];
  }

  async stop(options = {}) {
    if (!this.recording) {
      // Hardware already stopped but UI never entered recording — resync idle UI.
      if (options.fromHardware) {
        this.setPanel("idle");
        if (this.els.hint) {
          this.els.hint.textContent =
            "收音仅走 ESP32 + INMP441：开始录音 → 停止（最长 20s）→ 命名 → 保存（不用电脑麦克风）。";
        }
      }
      return;
    }

    const esp = this.getAdapter();
    const wifiSession = !!this._wifiSession;
    this.recording = false;
    this._stoppingForLimit = false;
    this.stopMeterLoop();

    this.pushMetricSample(true);

    const duration = Math.min(
      (Date.now() - this.startTime) / 1000,
      FieldRecorder.MAX_DURATION_SEC
    );

    if (esp) {
      esp.onMetrics = null;
      esp.onPcmFrame = null;
      if (!options.skipSerialCommand) {
        try {
          if (wifiSession || esp.isWifiLive?.()) {
            await esp.sendCommand("record_stop");
            await new Promise(r => setTimeout(r, 1200));
          } else if (esp?.isWsOpen()) {
            await esp.sendCommand("record_stop");
            await new Promise(r => setTimeout(r, 400));
          }
        } catch (err) {
          console.warn("[record] REC_STOP skipped:", err.message || err);
          await new Promise(r => setTimeout(r, wifiSession ? 1200 : 150));
        }
      } else if (options.skipSerialCommand) {
        await new Promise(r => setTimeout(r, wifiSession ? 1200 : 150));
      }
    }

    if (duration < 0.25) {
      alert("录音太短，请再录长一点。");
      this.setPanel("idle");
      this._wifiSession = false;
      return;
    }

    // Wi‑Fi path: device uploads PCM to Python; pull into library (no local PCM frames).
    if (wifiSession) {
      if (this.els.hint) {
        this.els.hint.textContent = "Wi‑Fi 上传中，正在同步声音库…";
      }
      try {
        await this.finishWifiUploadSession(options);
      } catch (err) {
        console.warn("[record] Wi‑Fi finish failed:", err);
        alert(
          "Wi‑Fi 录音已停止，但同步声音库失败。\n" +
          "请确认 Python :8001 可达，稍后打开 Transfer 手动同步。\n\n" +
          String(err && err.message ? err.message : err)
        );
        this.setPanel("idle");
      }
      this._wifiSession = false;
      return;
    }

    const sampleRate = esp?.sampleRate || 16000;
    const pcm = mergePcmChunks(this.pcmChunks);
    this.pcmChunks = [];
    this.pcmByteTotal = 0;

    // Hard requirement: only accept real INMP441 PCM — never computer mic,
    // never metrics-synthesized fake WAV.
    const minPcmBytes = 640; // ≥ ~20 ms @ 16 kHz mono PCM16
    if (pcm.length < minPcmBytes) {
      alert(
        "未收到 INMP441 真实 PCM，本次录音作废。\n\n" +
        "不会用电脑麦克风，也不会用音量曲线伪造音频。\n\n" +
        "请确认已烧录 esp32/inmp441_bridge.ino，Bridge 串口已开，" +
        "页面上方电平条在动后再录。"
      );
      this.setPanel("idle");
      return;
    }

    this.ensureMetricsBuffer(duration);

    const blob = encodeWavFromPcmBytes(pcm, sampleRate);
    this.usedPcmPath = true;

    this.savedMetricsSeries = this.metricsBuffer.map(s => ({ ...s }));
    this.metricsBuffer = [];

    if (!blob) {
      alert("无法从 INMP441 PCM 生成 WAV，请重试。");
      this.setPanel("idle");
      return;
    }

    this.pendingBlob = blob;
    this.pendingDuration = duration;

    if (this.els.nameInput) this.els.nameInput.value = this.defaultName();
    if (this.els.saveSummary) {
      const pcmKb = (pcm.length / 1024).toFixed(1);
      const maxPct = Math.round(
        Math.max(...this.savedMetricsSeries.map(s => s.level), 0) * 100
      );
      this.els.saveSummary.textContent =
        `${this.app.formatDuration(duration)} · INMP441 PCM ${pcmKb} KB · 峰值 ${maxPct}%`;
    }

    // Hardware / PCM session: Stop → auto Save (no manual Save click)
    if (options.fromHardware || options.autoSave === true || this.usedPcmPath) {
      if (this.els.hint) {
        this.els.hint.textContent = options.autoLimit
          ? `已达 ${FieldRecorder.MAX_DURATION_SEC}s，自动停止并保存…`
          : "录音结束，正在自动保存…";
      }
      await this.savePending({ quiet: true });
      return;
    }

    if (this.els.hint) {
      this.els.hint.textContent = options.autoLimit
        ? `已达 ${FieldRecorder.MAX_DURATION_SEC}s 上限，自动停止。点 ▶ 试听真实硬件原声，命名后 Save。`
        : "INMP441 录音已停止。点 ▶ 试听真实硬件原声，命名后 Save。";
    }

    this.setPreviewPlaying(false);
    this.setPanel("save");
    this.els.savePanel?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    this.els.nameInput?.focus();
  }

  async finishWifiUploadSession(options = {}) {
    const client = window.SoundsApiClient;
    if (!client || typeof client.syncIntoApp !== "function") {
      throw new Error("SoundsApiClient unavailable");
    }

    let importedIds = [];
    for (let i = 0; i < 8; i++) {
      const result = await client.syncIntoApp(this.app, { incremental: true });
      if (result && result.imported > 0) {
        importedIds = result.importedIds || [];
        break;
      }
      await new Promise(r => setTimeout(r, 700));
    }

    if (importedIds.length && typeof client.appendLatestBatch === "function") {
      client.appendLatestBatch(importedIds);
    }
    if (window.PikoSoundsScreen?.render) window.PikoSoundsScreen.render();
    if (typeof this.app.renderLibrary === "function") this.app.renderLibrary();

    const pipe = document.getElementById("pipelineStatus");
    if (pipe) {
      pipe.dataset.state = "connected";
      pipe.textContent = importedIds.length ? "Pipeline · Wi‑Fi saved" : "Pipeline · Wi‑Fi sync";
    }

    if (this.els.hint) {
      this.els.hint.textContent = importedIds.length
        ? `Wi‑Fi 录音已上传并同步（${importedIds.length}）。可在声音库使用。`
        : "Wi‑Fi 已停止；若库中暂无新文件，请稍后再同步 Transfer。";
    }
    this.setPanel("idle");
    this.metricsBuffer = [];
  }

  async savePending(options = {}) {
    if (!this.pendingBlob) {
      if (!options.quiet) alert("没有可保存的录音，请先 Start → Stop。");
      return;
    }
    this.stopPreview();
    const name = (this.els.nameInput?.value || this.defaultName()).trim() || this.defaultName();
    const file = new File([this.pendingBlob], `${name}.wav`, { type: "audio/wav" });

    const sample = await this.app.addFile(file, {
      displayName: name,
      source: "esp32-record",
      esp32MetricsSeries: this.savedMetricsSeries,
      esp32UsedPcm: this.usedPcmPath
    });

    if (!options.quiet && window.acousticAnalysisWindow) {
      window.acousticAnalysisWindow.analyzeAndShow(file, file.name, {
        sampleName: name,
        duration: sample?.duration || this.pendingDuration,
        sampleId: sample?.id
      });
    }

    const pipe = document.getElementById("pipelineStatus");
    if (pipe) {
      pipe.dataset.state = "ready";
      pipe.textContent = "Brush Ready";
    }

    this.savedMetricsSeries = [];

    this.pendingBlob = null;
    this.pendingDuration = 0;
    if (this.els.hint) {
      this.els.hint.textContent = options.quiet
        ? "已自动保存到 Sound Library。可继续录下一个。"
        : "已保存到 Sound Library。可以继续录下一个。";
    }
    this.setPanel("idle");
  }

  discardPending() {
    this.stopPreview();
    this.pendingBlob = null;
    this.pendingDuration = 0;
    if (this.els.hint) {
      this.els.hint.textContent = "已丢弃。准备好后再次 Start recording。";
    }
    this.setPanel("idle");
  }

  startMeterLoop() {
    const canvas = this.els.meter;
    if (!canvas) return;
    const g = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;

    const maxSec = FieldRecorder.MAX_DURATION_SEC;
    const tick = () => {
      if (!this.recording) return;

      this.pushMetricSample(false);

      let level = this.lastMeterLevel;
      const esp = this.getAdapter();
      if (esp?.isConnected()) {
        level = Math.max(level, esp.getNormalized().level);
      }
      this.lastMeterLevel = level;

      g.fillStyle = "#f5f4f2";
      g.fillRect(0, 0, w, h);
      const barW = Math.max(4, w * level * 0.92);
      g.fillStyle = "#3d6b52";
      g.fillRect((w - barW) / 2, h * 0.35, barW, h * 0.3);

      if (this.els.pointCount) {
        const pcmKb = ((this.pcmByteTotal || 0) / 1024).toFixed(1);
        this.els.pointCount.textContent =
          `INMP441 PCM：${pcmKb} KB · 点 ${this.metricsBuffer.length}`;
      }

      const elapsed = (Date.now() - this.startTime) / 1000;
      const shown = Math.min(elapsed, maxSec);
      if (this.els.timer) {
        this.els.timer.textContent = `${shown.toFixed(1)} / ${maxSec}s`;
        this.els.timer.classList.toggle("is-near-limit", shown >= maxSec - 3);
      }

      if (elapsed >= maxSec && !this._stoppingForLimit) {
        this._stoppingForLimit = true;
        this.stop({ autoLimit: true });
        return;
      }

      this.meterFrame = requestAnimationFrame(tick);
    };

    tick();
  }

  stopMeterLoop() {
    if (this.meterFrame) {
      cancelAnimationFrame(this.meterFrame);
      this.meterFrame = null;
    }
  }
}

window.FieldRecorder = FieldRecorder;
