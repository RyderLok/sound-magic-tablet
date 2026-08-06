// Python enhancement WebSocket client (Mode A — real-time).
class PythonEnhancementClient {
  constructor(options = {}) {
    this.httpBase = options.httpBase || "http://localhost:8001";
    this.wsUrl = options.wsUrl || "ws://localhost:8001/ws/audio";
    this.ws = null;
    this.connected = false;
    this.degraded = false;
    this.reconnectDelay = options.reconnectDelay ?? 2500;
    this.reconnectTimer = null;
    this.sequence = 0;
    this.lastSendAt = 0;
    this.minSendIntervalMs = 1000 / (options.targetHz || 20);
    this.lastResult = null;
    this.lastFeatures = null;
    this.lastModifiers = null;
    this.lastBrush = null;
    this.onResult = null;
    this._pendingPcm = null;
  }

  connect() {
    if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) {
      return;
    }
    try {
      this.ws = new WebSocket(this.wsUrl);
    } catch (err) {
      console.warn("[python] connect failed:", err);
      this._setState(false, true);
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.connected = true;
      this.degraded = false;
      console.log("[python] WebSocket connected:", this.wsUrl);
      this._updateStatus();
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type !== "analysis_result") return;
        this.lastResult = data;
        this.lastFeatures = FeatureSchema.normalizeFeatures(data.features);
        this.lastModifiers = this._normalizeModifiers(data.visualModifiers);
        this.lastBrush = data.brushParams || null;
        window.pythonEnhancedFeatures = this.lastFeatures;
        window.pythonVisualModifiers = this.lastModifiers;
        window.pythonBrushParams = this.lastBrush;
        if (this.onResult) this.onResult(data);
        this._updateStatus();
      } catch (err) {
        console.warn("[python] parse error:", err);
      }
    };

    this.ws.onerror = () => {
      this._setState(false, true);
      this._updateStatus();
    };

    this.ws.onclose = () => {
      this._setState(false, false);
      this._updateStatus();
      this.scheduleReconnect();
    };
  }

  _setState(connected, degraded) {
    this.connected = connected;
    this.degraded = degraded;
  }

  getState() {
    if (this.connected) return "connected";
    if (this.degraded) return "degraded";
    return "offline";
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
    this._setState(false, false);
  }

  ensureConnected() {
    if (this.ws?.readyState === WebSocket.OPEN) return;
    if (this.ws?.readyState === WebSocket.CONNECTING) return;
    if (this.ws) this.disconnect();
    this.connect();
  }

  syncFromHealth(health, httpBase, wsUrl) {
    // Prefer the base we successfully probed — never let a loopback health.http
    // rewrite a working remote analysisBaseUrl (iPad / tunnel).
    const probed = (httpBase || "").replace(/\/$/, "");
    const claimed = (health?.http || "").replace(/\/$/, "");
    const claimedLoop = /127\.0\.0\.1|localhost/i.test(claimed);
    const probedLoop = /127\.0\.0\.1|localhost/i.test(probed);
    let http = probed || this.httpBase;
    if (claimed && (!claimedLoop || probedLoop)) {
      http = claimed;
    }
    if (probed) http = probed;

    let ws = health?.endpoints?.wsAudio || health?.ws || wsUrl || this.wsUrl;
    if (window.PikoServiceEndpoints?.httpToWs) {
      const derived = window.PikoServiceEndpoints.httpToWs(http);
      const wsLoop = /127\.0\.0\.1|localhost/i.test(String(ws || ""));
      const httpLoop = /127\.0\.0\.1|localhost/i.test(http);
      if (derived && ((wsLoop && !httpLoop) || !ws)) ws = derived;
    }

    let changed = false;
    if (http && http !== this.httpBase) {
      this.httpBase = http;
      changed = true;
    }
    if (ws && ws !== this.wsUrl) {
      this.wsUrl = ws;
      changed = true;
    }
    if (changed) {
      console.log("[python] endpoints synced:", this.httpBase, this.wsUrl);
      this.disconnect();
    }
    this.ensureConnected();
  }

  markOffline() {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this._setState(true, false);
      this._updateStatus();
      return;
    }
    this._setState(false, false);
    this._updateStatus();
    this.ensureConnected();
  }

  async probeHealth() {
    try {
      const res = await fetch(`${this.httpBase}/health`, { signal: AbortSignal.timeout(4000) });
      if (!res.ok) return null;
      return await res.json();
    } catch (_) {
      return null;
    }
  }

  pushPcmFrame(bytes, sampleRate = 16000) {
    if (!bytes || !bytes.length) return;
    this._pendingPcm = { bytes, sampleRate };
    const now = Date.now();
    if (now - this.lastSendAt < this.minSendIntervalMs) return;
    this._flushPcm();
  }

  _flushPcm() {
    if (!this._pendingPcm || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const { bytes, sampleRate } = this._pendingPcm;
    this._pendingPcm = null;
    this.lastSendAt = Date.now();
    this.sequence += 1;

    const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const samples = [];
    for (let i = 0; i + 1 < view.length; i += 2) {
      const v = view[i] | (view[i + 1] << 8);
      samples.push(v > 32767 ? v - 65536 : v);
    }
    if (!samples.length) return;

    this.ws.send(JSON.stringify({
      type: "audio_frame",
      timestamp: Date.now(),
      sampleRate,
      channels: 1,
      format: "pcm_s16le",
      sequence: this.sequence,
      samples
    }));
  }

  async analyzeWavBlob(blob, filename = "recording.wav") {
    try {
      const form = new FormData();
      form.append("file", blob, filename);
      // Qwen can take 30–90s; remote/iPad needs headroom.
      const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
      const timer = ctrl ? setTimeout(() => ctrl.abort(), 120000) : null;
      const res = await fetch(`${this.httpBase}/analyze/wav`, {
        method: "POST",
        body: form,
        signal: ctrl ? ctrl.signal : undefined
      });
      if (timer) clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      this.lastResult = data;
      this.lastFeatures = FeatureSchema.normalizeFeatures(data.features);
      this.lastModifiers = this._normalizeModifiers(data.visualModifiers);
      this.lastBrush = data.brushParams || null;
      window.pythonEnhancedFeatures = this.lastFeatures;
      window.pythonVisualModifiers = this.lastModifiers;
      window.pythonBrushParams = this.lastBrush;
      window.pythonAcousticViz = data.acoustic || null;
      window.activeAcousticViz = data.acoustic || null;
      window.activeShapeProfile = data.acoustic?.shapeProfile || null;
      window.pythonAnalysisExport = data.analysisExport || null;
      window.pythonSemantic = data.semantic || null;
      window.pythonSemanticError = data.semanticError || null;
      window.logSoundFingerprint?.(filename, this.lastFeatures, window.activeAcousticViz);
      return data;
    } catch (err) {
      console.warn("[python] full analysis failed:", err);
      return null;
    }
  }

  _normalizeModifiers(raw) {
    const out = {};
    FeatureSchema.MODIFIER_KEYS.forEach(k => {
      out[k] = FeatureSchema.clamp01(raw?.[k]);
    });
    return out;
  }

  _updateStatus() {
    const el = document.getElementById("pythonStatus");
    if (!el) return;
    const state = this.getState();
    el.dataset.state = state;
    const labels = {
      connected: "Python · Connected",
      degraded: "Python · Degraded",
      offline: "Python · Offline"
    };
    el.textContent = labels[state] || state;
  }
}

window.PythonEnhancementClient = PythonEnhancementClient;
