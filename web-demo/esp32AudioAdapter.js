// WebSocket client for ESP32 INMP441 — metrics + hardware PCM recording.
class Esp32AudioAdapter {
  constructor(options = {}) {
    this.url = options.url || "ws://localhost:8765";
    this.ws = null;
    this.connected = false;
    this.pcmCapable = false;
    this.sampleRate = 16000;
    this.reconnectDelay = options.reconnectDelay ?? 2000;
    this.reconnectTimer = null;
    this.lastMessageAt = 0;
    this.messageCount = 0;
    this.serialOpen = null;
    this.serialPort = null;
    this.serialBaud = null;
    this.lastVolumePct = null;
    this.onPcmFrame = null;
    this.onMetrics = null;
    this.onHardwareRecord = null;
    this._cmdWaiters = [];
    this.smoothed = { level: 0, peak: 0, mean: 0 };
    this.calibration = { maxLevel: 12000, maxPeak: 65000, maxMean: 8000 };
    this.flashBoost = 0;
    this.drift = { x: 0, y: 0 };
    this.wavePhase = 0;
    this.waveCanvas = null;
    this.waveCtx = null;
    this.waveAnimFrame = null;
    this._waveInited = false;
    // Wi‑Fi control plane (no USB Bridge): poll /metrics + HTTP record start/stop
    this.wifiBase = options.wifiBase || "";
    this.wifiMode = false;
    this.wifiRecording = false;
    this._wifiPollTimer = null;
    this._wifiDiscoverAt = 0;
  }

  initWaveMonitor() {
    if (this._waveInited) return;
    this._waveInited = true;
    this.waveCanvas = document.getElementById("esp32LiveWave");
    if (!this.waveCanvas) return;
    this.waveCtx = this.waveCanvas.getContext("2d");
    const w = this.waveCanvas.width;
    const h = this.waveCanvas.height;
    this.waveCtx.fillStyle = "#eef2ef";
    this.waveCtx.fillRect(0, 0, w, h);
    this.waveCtx.strokeStyle = "#c8d4cc";
    this.waveCtx.lineWidth = 1;
    this.waveCtx.beginPath();
    this.waveCtx.moveTo(0, h / 2);
    this.waveCtx.lineTo(w, h / 2);
    this.waveCtx.stroke();
    if (!this.waveAnimFrame) {
      const tick = () => {
        this.drawLiveWave();
        this.waveAnimFrame = requestAnimationFrame(tick);
      };
      tick();
    }
  }

  getLiveAmplitude() {
    const pct = (this.lastVolumePct ?? 0) / 100;
    const peak = this.getNormalized().peak;
    return Math.min(1, pct * 0.82 + peak * 0.28);
  }

  drawLiveWave() {
    if (!this.waveCtx || !this.waveCanvas) return;

    const ctx = this.waveCtx;
    const w = this.waveCanvas.width;
    const h = this.waveCanvas.height;
    const mid = h / 2;
    const amp = this.getLiveAmplitude();
    const active = this.isActive();
    const detecting = active && amp > 0.06;

    ctx.drawImage(this.waveCanvas, 1, 0, w - 1, h, 0, 0, w - 1, h);
    ctx.fillStyle = "#eef2ef";
    ctx.fillRect(w - 1, 0, 1, h);

    ctx.strokeStyle = "#dde5e0";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(w - 1, mid);
    ctx.lineTo(w, mid);
    ctx.stroke();

    this.wavePhase += 0.12 + amp * 0.55;
    const waveH = detecting ? amp * (mid - 5) : 0;
    const y = mid - Math.sin(this.wavePhase) * waveH;

    ctx.strokeStyle = detecting ? "#3d6b52" : "#b8c4bc";
    ctx.lineWidth = detecting ? 2 : 1.2;
    ctx.beginPath();
    ctx.moveTo(w - 2, mid);
    ctx.lineTo(w - 1, y);
    ctx.stroke();

    const monitor = document.getElementById("esp32LiveMonitor");
    monitor?.classList.toggle("is-detecting", detecting);
  }

  connect() {
    this.initWaveMonitor();
    this.ensureWifiTransport();
    if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) {
      return;
    }

    try {
      this.ws = new WebSocket(this.url);
    } catch (err) {
      console.warn("[esp32] connect failed:", err);
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.connected = true;
      console.log("[esp32] WebSocket connected:", this.url);
      this.updateLiveMonitor();
      this.refreshConnectionStatus();
      if (this._liveMonitorTimer) clearInterval(this._liveMonitorTimer);
      this._liveMonitorTimer = setInterval(() => this.updateLiveMonitor(), 500);
    };

    this.ws.onmessage = (event) => this.handleMessage(event.data);

    this.ws.onerror = () => {
      console.warn("[esp32] WebSocket error");
      if (!this.wifiMode) this.updateStatus("error");
    };

    this.ws.onclose = () => {
      this.connected = false;
      if (!this.wifiMode) this.serialOpen = false;
      if (!this.wifiMode) this.updateStatus("disconnected");
      if (this._liveMonitorTimer) {
        clearInterval(this._liveMonitorTimer);
        this._liveMonitorTimer = null;
      }
      this.updateLiveMonitor();
      this.scheduleReconnect();
      this.ensureWifiTransport();
    };
  }

  pythonHttpBase() {
    if (window.App && window.App.pythonBaseUrl) return String(window.App.pythonBaseUrl).replace(/\/$/, "");
    if (window.PikoServiceEndpoints?.resolvePythonEndpoints) {
      const ep = window.PikoServiceEndpoints.resolvePythonEndpoints();
      if (ep && ep.http) return String(ep.http).replace(/\/$/, "");
    }
    return "http://127.0.0.1:8001";
  }

  configuredWifiBase() {
    if (this.wifiBase) return String(this.wifiBase).replace(/\/$/, "");
    if (window.PikoServiceEndpoints?.resolveEsp32HttpBase) {
      return String(window.PikoServiceEndpoints.resolveEsp32HttpBase() || "").replace(/\/$/, "");
    }
    return "";
  }

  async discoverWifiBase() {
    const now = Date.now();
    if (now - this._wifiDiscoverAt < 2500) return this.wifiBase || "";
    this._wifiDiscoverAt = now;

    const candidates = [];
    const configured = this.configuredWifiBase();
    if (configured) candidates.push(configured);
    candidates.push("http://piko-esp.local:8080");

    try {
      const res = await fetch(this.pythonHttpBase() + "/esp32", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        const base = data?.esp32?.base;
        if (base) candidates.unshift(String(base).replace(/\/$/, ""));
      }
    } catch (_) { /* ignore */ }

    for (const base of candidates) {
      if (!base) continue;
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 900);
        const res = await fetch(base + "/metrics", { cache: "no-store", signal: ctrl.signal });
        clearTimeout(t);
        if (res.ok) {
          this.wifiBase = base;
          if (window.PikoServiceEndpoints?.saveEsp32Base) {
            window.PikoServiceEndpoints.saveEsp32Base(base);
          }
          return base;
        }
      } catch (_) { /* try next */ }
    }
    return this.wifiBase || "";
  }

  startWifiPolling(base) {
    const b = String(base || "").replace(/\/$/, "");
    if (!b) return;
    this.wifiBase = b;
    this.wifiMode = true;
    this.serialOpen = true;
    this.pcmCapable = true;
    this.lastMessageAt = Date.now();
    this.updateStatus("connected");
    console.log("[esp32] Wi‑Fi control plane:", b);
    if (!this._wifiPollTimer) {
      this._wifiPollTimer = setInterval(() => this.pollWifiMetrics(), 80);
    }
    return this.pollWifiMetrics();
  }

  async ensureWifiTransport() {
    // Prefer USB Bridge when it is live; otherwise enable Wi‑Fi metrics/control.
    if (this.isUsbLive()) return true;
    const base = await this.discoverWifiBase();
    if (!base) return false;
    await this.startWifiPolling(base);
    return this.isWifiLive() || this.wifiMode;
  }

  isUsbLive() {
    return this.isWsOpen() && this.serialOpen === true && (Date.now() - this.lastMessageAt) < 4000;
  }

  stopWifiPolling() {
    if (this._wifiPollTimer) {
      clearInterval(this._wifiPollTimer);
      this._wifiPollTimer = null;
    }
  }

  async pollWifiMetrics() {
    if (this.isUsbLive()) {
      // USB took over — pause Wi‑Fi polling but keep base for fallback.
      return;
    }
    const python = this.pythonHttpBase();
    const urls = [];
    if (this.wifiBase) urls.push(this.wifiBase.replace(/\/$/, "") + "/metrics");
    urls.push(python + "/esp32/metrics");

    for (const url of urls) {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 700);
        const res = await fetch(url, { cache: "no-store", signal: ctrl.signal });
        clearTimeout(t);
        if (!res.ok) continue;
        const data = await res.json();
        this.applyWifiMetrics(data);
        return;
      } catch (_) { /* try next */ }
    }
  }

  applyWifiMetrics(data) {
    if (!data) return;
    this.wifiMode = true;
    this.serialOpen = true;
    this.pcmCapable = true;
    const wasRecording = this.wifiRecording;
    this.wifiRecording = !!data.recording;

    const volume = Number(data.volume);
    const peak = Number(data.peak);
    const levelRaw = Number(data.level);
    const volumePct = Number.isFinite(volume) ? volume : undefined;
    const level = Number.isFinite(levelRaw)
      ? levelRaw
      : (Number.isFinite(volumePct) ? (volumePct / 100) * 32768 : 0);
    const peakVal = Number.isFinite(peak) ? peak : level;

    this.ingestMetrics({
      level,
      peak: peakVal,
      mean: level * 0.35,
      timestamp: Date.now(),
      volumePct
    });

    if (!wasRecording && this.wifiRecording && typeof this.onHardwareRecord === "function") {
      this.onHardwareRecord({ status: "started", source: "wifi", timestamp: Date.now() });
    }
    if (wasRecording && !this.wifiRecording && typeof this.onHardwareRecord === "function") {
      this.onHardwareRecord({ status: "stopped", source: "wifi", timestamp: Date.now() });
    }
    this.refreshConnectionStatus();
  }

  /** Collect Ready: USB serial open OR Wi‑Fi metrics live. */
  refreshConnectionStatus() {
    if (this.isWifiLive()) {
      this.updateStatus("connected");
      return;
    }
    if (!this.isWsOpen()) {
      this.updateStatus("disconnected");
      return;
    }
    if (this.serialOpen === true) {
      this.updateStatus("connected");
    } else {
      this.updateStatus("disconnected");
    }
  }

  scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.reconnectDelay);
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try { this.ws.close(); } catch (_) { /* ignore */ }
      this.ws = null;
    }
    this.connected = false;
  }

  ensureConnected() {
    this.ensureWifiTransport();
    if (this.isWsOpen()) return;
    if (this.ws?.readyState === WebSocket.CONNECTING) return;
    if (this.ws) this.disconnect();
    this.connect();
  }

  syncFromBridgeHealth(health, wsUrl) {
    if (wsUrl && wsUrl !== this.url) {
      this.url = wsUrl;
      this.disconnect();
    } else if (health?.ws && health.ws !== this.url) {
      this.url = health.ws;
      this.disconnect();
    }
    if (health?.serial) {
      this.serialOpen = !!health.serial.open;
      this.serialPort = health.serial.port || null;
      this.serialBaud = health.serial.baud || null;
    }
    if (health?.pcm != null) this.pcmCapable = !!health.pcm;
    if (health?.sampleRate) this.sampleRate = health.sampleRate;
    this.refreshConnectionStatus();
    this.updateLiveMonitor();
  }

  isWsOpen() {
    return !!(this.ws && this.ws.readyState === WebSocket.OPEN);
  }

  isWifiLive() {
    return !!(this.wifiMode && (Date.now() - this.lastMessageAt) < 3000);
  }

  /** USB Bridge open OR Wi‑Fi metrics path live. */
  isTransportReady() {
    return this.isUsbLive() || this.isWifiLive();
  }

  sendCommand(cmd) {
    // Wi‑Fi HTTP control when USB Bridge is not live
    if (!this.isUsbLive() && (this.wifiMode || this.wifiBase || this.configuredWifiBase())) {
      return this.sendWifiCommand(cmd);
    }
    return new Promise((resolve, reject) => {
      if (!this.isWsOpen()) {
        reject(new Error("WebSocket not connected"));
        return;
      }
      const expect = cmd === "record_start" ? "started" : cmd === "record_stop" ? "stopped" : null;
      const timeout = setTimeout(() => {
        reject(new Error(`Command timeout: ${cmd}`));
      }, 4000);

      if (expect) {
        this._cmdWaiters.push({ expect, resolve, reject, timeout });
      } else {
        clearTimeout(timeout);
        resolve();
      }

      this.ws.send(JSON.stringify({ cmd }));
    });
  }

  async sendWifiCommand(cmd) {
    const action = cmd === "record_start" ? "start"
      : cmd === "record_stop" ? "stop"
      : null;
    if (!action) throw new Error("Unsupported Wi‑Fi cmd: " + cmd);

    const python = this.pythonHttpBase();
    const tries = [];
    if (this.wifiBase) tries.push(this.wifiBase.replace(/\/$/, "") + "/record/" + action);
    tries.push(python + "/esp32/record/" + action);

    let lastErr = null;
    for (const url of tries) {
      try {
        const res = await fetch(url, { method: "POST", cache: "no-store" });
        if (!res.ok) throw new Error("HTTP " + res.status);
        this.wifiRecording = action === "start";
        return { status: action === "start" ? "started" : "stopped", via: "wifi", url };
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr || new Error("Wi‑Fi record command failed");
  }

  handleMessage(raw) {
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      return;
    }

    if (parsed.type === "bridge") {
      this.pcmCapable = !!parsed.pcm;
      this.sampleRate = parsed.sampleRate || 16000;
      this.serialOpen = parsed.serialOpen != null ? !!parsed.serialOpen : this.serialOpen;
      if (parsed.serialPort) this.serialPort = parsed.serialPort;
      this.lastMessageAt = Date.now();
      this.refreshConnectionStatus();
      this.updateLiveMonitor();
      // Resync Keyes/UI if ESP32 is already recording when the page connects.
      if (parsed.recording === true && typeof this.onHardwareRecord === "function") {
        this.onHardwareRecord({ status: "started", source: "bridge_sync", timestamp: parsed.timestamp });
      }
      return;
    }

    if (parsed.type === "session") {
      if (typeof this.onSession === "function") {
        this.onSession(parsed);
      }
      return;
    }

    if (parsed.type === "hw_record") {
      if (typeof this.onHardwareRecord === "function") {
        this.onHardwareRecord(parsed);
      }
      return;
    }

    if (parsed.type === "record_ack") {
      const waiter = this._cmdWaiters.find(w => w.expect === parsed.status);
      if (waiter) {
        clearTimeout(waiter.timeout);
        this._cmdWaiters = this._cmdWaiters.filter(w => w !== waiter);
        waiter.resolve(parsed);
      }
      return;
    }

    if (parsed.type === "pcm" && parsed.data) {
      this.lastMessageAt = Date.now();
      this.pcmCapable = true;
      // Keyes may stream PCM before UI armed — let FieldRecorder enter recording
      if (typeof this.onPcmArmRecording === "function") {
        this.onPcmArmRecording();
      }
      const binary = Uint8Array.from(atob(parsed.data), c => c.charCodeAt(0));
      if (this.onPcmFrame) this.onPcmFrame(binary, parsed);
      if (this.onPcmForPython) this.onPcmForPython(binary, parsed.sampleRate || this.sampleRate);
      const level = pcmLevelFromBytes(binary);
      this.ingestMetrics({
        level: Math.round(level * this.calibration.maxLevel),
        peak: Math.round(level * this.calibration.maxPeak),
        mean: 0,
        timestamp: parsed.timestamp || Date.now()
      });
      return;
    }

    if (parsed.type === "metrics" || parsed.volume !== undefined) {
      const volumePct = parsed.volume !== undefined ? Number(parsed.volume) : parsed.volumePct;
      const level = parsed.level !== undefined
        ? this.clampNumber(parsed.level)
        : (Number.isFinite(volumePct) ? (volumePct / 100) * 32768 : 0);
      this.ingestMetrics({
        level,
        peak: this.clampNumber(parsed.peak !== undefined ? parsed.peak : level),
        mean: this.clampNumber(parsed.mean || level * 0.35),
        timestamp: parsed.timestamp || Date.now(),
        volumePct
      });
      return;
    }

    if (parsed.level !== undefined || parsed.peak !== undefined || parsed.mean !== undefined) {
      this.ingestMetrics({
        level: this.clampNumber(parsed.level),
        peak: this.clampNumber(parsed.peak),
        mean: this.clampNumber(parsed.mean),
        timestamp: parsed.timestamp || Date.now(),
        volumePct: parsed.volumePct
      });
    }
  }

  resetRecordingCalibration() {
    this.calibration = { maxLevel: 3000, maxPeak: 6000, maxMean: 1500 };
    this.smoothed = { level: 0, peak: 0, mean: 0 };
    this.lastMessageAt = Date.now();
  }

  legacyLevelToPct(level) {
    return this.clamp01((this.clampNumber(level) - 200) / 15000);
  }

  updateLiveMonitor() {
    const label = document.getElementById("esp32LiveLabel");
    const monitor = document.getElementById("esp32LiveMonitor");
    if (!label) return;

    const open = this.isTransportReady();
    const active = this.isActive();
    const amp = this.getLiveAmplitude();
    const detecting = active && amp > 0.06;
    const viaWifi = this.isWifiLive() && !this.isUsbLive();

    if (!open) {
      label.textContent = "INMP441 未连接 — 启动 Bridge(USB) 或等待 ESP32 Wi‑Fi /metrics";
      monitor?.classList.remove("is-live", "is-detecting");
      return;
    }

    if (!viaWifi && this.isWsOpen() && this.serialOpen === false) {
      label.textContent = "INMP441 串口未开 — 关闭串口监视器并重启 Bridge（或改用 Wi‑Fi）";
      monitor?.classList.remove("is-live", "is-detecting");
      return;
    }

    if (!active && this.messageCount === 0) {
      label.textContent = viaWifi
        ? "INMP441 Wi‑Fi 已连接，等待声音…"
        : "INMP441 已连接，等待声音…";
      monitor?.classList.remove("is-live", "is-detecting");
      return;
    }

    monitor?.classList.toggle("is-live", active);
    monitor?.classList.toggle("is-detecting", detecting);

    if (!active && this.messageCount > 0) {
      label.textContent = viaWifi
        ? "INMP441 Wi‑Fi 数据中断（检查热点 / ESP32）"
        : "INMP441 数据中断（检查接线 / 串口）";
    } else if (detecting) {
      label.textContent = viaWifi ? "INMP441 Wi‑Fi · 检测到声音" : "INMP441 · 检测到声音";
    } else {
      label.textContent = viaWifi ? "INMP441 Wi‑Fi · 监听中" : "INMP441 · 监听中";
    }
  }

  ingestMetrics({ level, peak, mean, timestamp, volumePct }) {
    this.audioData = { level, peak, mean, timestamp, volumePct: volumePct !== undefined ? Number(volumePct) : undefined };
    this.lastMessageAt = Date.now();
    this.messageCount += 1;
    this.updateCalibration(level, peak, mean);

    let pctValue = volumePct !== undefined ? Number(volumePct) : this.legacyLevelToPct(level) * 100;
    if (!Number.isFinite(pctValue)) pctValue = 0;
    this.lastVolumePct = Math.round(Math.max(0, Math.min(100, pctValue)));

    const levelNorm = this.normalizeLevel(this.smoothed.level);
    this.smoothed.level = this.lerp(this.smoothed.level, level, 0.22);
    this.smoothed.peak = this.lerp(this.smoothed.peak, peak, 0.35);
    this.smoothed.mean = this.lerp(this.smoothed.mean, mean, 0.12);

    const peakNorm = this.normalizePeak(this.smoothed.peak);
    const spike = Math.max(0, peakNorm - levelNorm * 0.85);
    this.flashBoost = this.lerp(this.flashBoost, spike * 28, 0.4);

    const meanNorm = this.clamp01(Math.abs(this.smoothed.mean) / Math.max(1, this.calibration.maxMean));
    const driftScale = 12 + levelNorm * 18;
    this.drift.x = this.lerp(this.drift.x, (this.smoothed.mean / Math.max(1, this.calibration.maxMean)) * driftScale, 0.08);
    this.drift.y = this.lerp(this.drift.y, Math.sin(timestamp * 0.0015 + meanNorm * 3) * meanNorm * driftScale * 0.35, 0.06);

    if (volumePct !== undefined && Number.isFinite(Number(volumePct))) {
      const pct = Number(volumePct) / 100;
      this.smoothed.level = Math.max(this.smoothed.level, pct);
      this.smoothed.peak = Math.max(this.smoothed.peak, pct * 1.1);
    } else if (this.lastVolumePct > 0) {
      const pct = this.lastVolumePct / 100;
      this.smoothed.level = Math.max(this.smoothed.level, pct);
    }

    this.updateLiveMonitor();

    if (this.onMetrics) {
      const n = this.getNormalized();
      this.onMetrics({
        timestamp,
        level,
        peak,
        mean,
        levelNorm: this.lastVolumePct / 100,
        peakNorm: n.peak,
        volumePct: this.lastVolumePct
      });
    }
  }

  isActive() {
    return this.isTransportReady() && (Date.now() - this.lastMessageAt) < 4000;
  }

  isConnected() {
    return this.isActive();
  }

  /** USB Bridge serial OR Wi‑Fi metrics path. */
  isHardwareReady() {
    if (this.isWifiLive()) return true;
    return this.isWsOpen() && this.serialOpen !== false;
  }

  getNormalized() {
    return {
      level: this.normalizeLevel(this.smoothed.level),
      peak: this.normalizePeak(this.smoothed.peak),
      mean: this.clamp01(Math.abs(this.smoothed.mean) / Math.max(1, this.calibration.maxMean))
    };
  }

  getVisualFeatures() {
    const n = this.getNormalized();
    return {
      volume: n.level,
      low: this.clamp01(n.level * 0.55 + 0.08),
      mid: this.clamp01(n.level * 0.35 + n.mean * 0.25),
      high: this.clamp01(n.peak * 0.9 + 0.04),
      centroid: this.clamp01(n.peak * 0.6 + n.mean * 0.4),
      flashBoost: this.flashBoost,
      driftX: this.drift.x,
      driftY: this.drift.y,
      meanSigned: this.smoothed.mean / Math.max(1, this.calibration.maxMean)
    };
  }

  toAnalyzerFeatures() {
    const n = this.getNormalized();
    const v = this.getVisualFeatures();
    return {
      volume: v.volume,
      bass: v.low,
      mid: v.mid,
      treble: v.high,
      brightness: v.centroid,
      energy: this.clamp01(v.volume * 0.5 + v.high * 0.3 + v.low * 0.2),
      roughness: this.clamp01(n.peak * 0.7 + n.mean * 0.3)
    };
  }

  updateCalibration(level, peak, mean) {
    this.calibration.maxLevel = Math.max(this.calibration.maxLevel * 0.998, level * 1.35, 1000);
    this.calibration.maxPeak = Math.max(this.calibration.maxPeak * 0.998, peak * 1.35, 4000);
    this.calibration.maxMean = Math.max(this.calibration.maxMean * 0.998, Math.abs(mean) * 1.5, 500);
  }

  updateStatus(state) {
    const el = document.getElementById("esp32Status");
    if (!el) return;
    el.dataset.state = state;
    const labels = {
      connected: "ESP32 · Connected",
      disconnected: "ESP32 · Disconnected",
      error: "ESP32 · Error"
    };
    el.textContent = labels[state] || state;
  }

  clampNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  normalizeLevel(value) {
    return this.clamp01(value / Math.max(1, this.calibration.maxLevel));
  }

  normalizePeak(value) {
    return this.clamp01(value / Math.max(1, this.calibration.maxPeak));
  }

  clamp01(value) {
    return Math.min(1, Math.max(0, value));
  }

  lerp(a, b, t) {
    return a + (b - a) * t;
  }
}

window.Esp32AudioAdapter = Esp32AudioAdapter;
