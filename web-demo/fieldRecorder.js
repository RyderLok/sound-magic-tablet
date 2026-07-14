// Field recorder — ESP32 hardware stream only (no computer microphone).
class FieldRecorder {
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
    this.savedMetricsSeries = [];
    this.previewAudio = null;
    this.previewUrl = null;
    this.previewPlaying = false;
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
        this.stop({ skipSerialCommand: true, fromHardware: true });
      }
    };
    // If Keyes skips rec_start JSON and only streams PCM, first frame still arms UI
    esp.onPcmArmRecording = () => {
      if (!this.recording) {
        this.start({ skipSerialCommand: true, fromHardware: true });
      }
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

  hardwareErrorMessage() {
    return "ESP32 未连接。\n\n请确认 Bridge 在运行：\nnode bridge/serial-bridge.js --port COM3\n\n并关闭 Arduino 串口监视器。";
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
    if (!esp?.isWsOpen()) {
      if (!options.fromHardware) alert(this.hardwareErrorMessage());
      return;
    }

    esp.resetRecordingCalibration();
    this.metricsBuffer = [];
    this.pcmChunks = [];
    this.recording = true;
    this.startTime = Date.now();
    this.lastSampleAt = 0;
    this.usedPcmPath = false;

    // Keyes already toggled ESP32 recording — do not send REC_START again
    if (!options.skipSerialCommand && esp?.isWsOpen()) {
      esp.sendCommand("record_start").catch(err => {
        console.warn("[record] REC_START skipped:", err.message);
      });
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
        this.els.pointCount.textContent = `硬件数据：${this.metricsBuffer.length} 点 · 音量 ${Math.round(level * 100)}%`;
      }
    };

    esp.onPcmFrame = (bytes) => {
      if (!this.recording) return;
      this.pcmChunks.push(bytes);
      this.lastMeterLevel = pcmLevelFromBytes(bytes);
      this.pushMetricSample(true);
    };

    const pipe = document.getElementById("pipelineStatus");
    if (pipe) {
      pipe.dataset.state = "recording";
      pipe.textContent = "Recording";
    }

    this.pushMetricSample(true);

    this.setPanel("active");
    if (this.els.hint) {
      this.els.hint.textContent = options.fromHardware
        ? "正在录音… 再按 Keyes 按钮或点 Stop 结束。"
        : "正在录音… 按 Stop 结束（不会自动保存）。";
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
    if (!this.recording) return;

    const esp = this.getAdapter();
    this.recording = false;
    this.stopMeterLoop();

    this.pushMetricSample(true);

    const duration = (Date.now() - this.startTime) / 1000;

    if (esp) {
      esp.onMetrics = null;
      esp.onPcmFrame = null;
      // Keyes already stopped ESP32 — do not send REC_STOP again
      if (!options.skipSerialCommand && esp?.isWsOpen()) {
        esp.sendCommand("record_stop").catch(err => {
          console.warn("[record] REC_STOP skipped:", err.message);
        });
        await new Promise(r => setTimeout(r, 400));
      } else if (options.skipSerialCommand) {
        await new Promise(r => setTimeout(r, 150));
      }
    }

    if (duration < 0.25) {
      alert("录音太短，请再录长一点。");
      this.setPanel("idle");
      return;
    }

    const sampleRate = esp?.sampleRate || 16000;
    const pcm = mergePcmChunks(this.pcmChunks);
    this.pcmChunks = [];

    if (this.metricsBuffer.length < 2 && pcm.length < 640) {
      alert(
        "没有收到 ESP32 硬件数据。\n\n请先看页面上方「ESP32 实时」条是否有音量跳动。\n" +
        "若没有：关闭 Arduino 串口监视器 → 运行 node bridge/serial-bridge.js --port COM3"
      );
      this.setPanel("idle");
      return;
    }

    this.ensureMetricsBuffer(duration);

    let blob = null;

    if (pcm.length >= 640) {
      blob = encodeWavFromPcmBytes(pcm, sampleRate);
      this.usedPcmPath = true;
    } else {
      blob = synthesizeWavFromMetrics(this.metricsBuffer, sampleRate);
      this.usedPcmPath = false;
    }

    const sampleCount = this.metricsBuffer.length;
    this.savedMetricsSeries = this.metricsBuffer.map(s => ({ ...s }));
    this.metricsBuffer = [];

    if (!blob) {
      alert("无法生成录音文件，请确认 ESP32 有数据（电平条在动）。");
      this.setPanel("idle");
      return;
    }

    this.pendingBlob = blob;
    this.pendingDuration = duration;

    if (this.els.nameInput) this.els.nameInput.value = this.defaultName();
    if (this.els.saveSummary) {
      const via = this.usedPcmPath ? "ESP32 真实 PCM" : "音量曲线还原（非原声）";
      const maxPct = Math.round(
        Math.max(...this.savedMetricsSeries.map(s => s.level), 0) * 100
      );
      this.els.saveSummary.textContent =
        `${this.app.formatDuration(duration)} · ${sampleCount} 点 · 峰值 ${maxPct}% · ${via}`;
    }
    if (this.els.hint) {
      this.els.hint.textContent = this.usedPcmPath
        ? "录音已停止。点 ▶ 试听真实硬件录音，输入名称后 Save 保存。"
        : "当前 Arduino 只传音量数字，试听不是原声。要录真实声音请烧录 esp32/inmp441_record.ino（921600）。点 ▶ 可听能量还原版。";
    }

    this.setPreviewPlaying(false);
    this.setPanel("save");
    this.els.savePanel?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    this.els.nameInput?.focus();
  }

  async savePending() {
    if (!this.pendingBlob) {
      alert("没有可保存的录音，请先 Start → Stop。");
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

    if (window.acousticAnalysisWindow) {
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
      this.els.hint.textContent = "已保存到 Sound Library。可以继续录下一个。";
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
        this.els.pointCount.textContent = `硬件数据：${this.metricsBuffer.length} 点`;
      }

      if (this.els.timer) {
        this.els.timer.textContent = ((Date.now() - this.startTime) / 1000).toFixed(1) + "s";
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
