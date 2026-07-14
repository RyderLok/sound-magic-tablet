// Auto-probe Python + Bridge, sync API URLs, and keep WebSocket clients connected.
class ServiceConnectionManager {
  constructor(app) {
    this.app = app;
    this.pollMs = 3500;
    this._timer = null;
    this._tickInFlight = false;

    this.pythonHttp = "http://127.0.0.1:8001";
    this.pythonWs = "ws://127.0.0.1:8001/ws/audio";
    this.bridgeWs = "ws://127.0.0.1:8765";
    this.bridgeHealthUrls = [
      "http://127.0.0.1:8766/health",
      "http://localhost:8766/health"
    ];

    this.lastPythonHealth = null;
    this.lastBridgeHealth = null;
    this.lastSyncAt = 0;
  }

  _fetchJson(url, timeoutMs = 4000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    return fetch(url, { signal: controller.signal })
      .then((res) => {
        clearTimeout(timer);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .catch((err) => {
        clearTimeout(timer);
        throw err;
      });
  }

  start() {
    this.tick();
    if (this._timer) clearInterval(this._timer);
    this._timer = setInterval(() => this.tick(), this.pollMs);
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
  }

  async tick() {
    if (this._tickInFlight) return;
    this._tickInFlight = true;
    try {
      const [pyHealth, bridgeHealth] = await Promise.all([
        this.probePythonHealth(),
        this.probeBridgeHealth()
      ]);

      this.lastPythonHealth = pyHealth;
      this.lastBridgeHealth = bridgeHealth;
      this.lastSyncAt = Date.now();

      this.syncPythonClient(pyHealth);
      this.syncEsp32Client(bridgeHealth);

      this.app.esp32AudioAdapter?.ensureConnected?.();
      this.app.pythonClient?.ensureConnected?.();

      this.updateIntegrationUI(pyHealth, bridgeHealth);
      this.updatePipelineStatus(pyHealth, bridgeHealth);
    } catch (err) {
      console.warn("[service] tick failed:", err);
      this.updateIntegrationUI(this.lastPythonHealth, this.lastBridgeHealth);
    } finally {
      this._tickInFlight = false;
    }
  }

  async probePythonHealth() {
    const bases = [this.pythonHttp, "http://localhost:8001"];
    const seen = new Set();
    for (const base of bases) {
      if (!base || seen.has(base)) continue;
      seen.add(base);
      try {
        const data = await this._fetchJson(`${base}/health`, 4000);
        if (data?.status === "ok") {
          this.applyPythonEndpoints(data, base);
          return data;
        }
      } catch (_) {
        /* try next base */
      }
    }
    return null;
  }

  applyPythonEndpoints(health, fetchedBase) {
    const http = health.http || health.endpoints?.health?.replace(/\/health\/?$/, "") || fetchedBase;
    const ws = health.endpoints?.wsAudio || health.ws || this.pythonWs;
    if (http) this.pythonHttp = http.replace(/\/$/, "");
    if (ws) this.pythonWs = ws;
  }

  async probeBridgeHealth() {
    for (const url of this.bridgeHealthUrls) {
      try {
        const data = await this._fetchJson(url, 3000);
        if (data?.ws) this.bridgeWs = data.ws;
        return data;
      } catch (_) {
        /* try next */
      }
    }

    const wsOpen = !!this.app.esp32AudioAdapter?.isWsOpen?.();
    if (wsOpen) {
      return {
        status: "ok",
        ws: this.bridgeWs,
        serial: { open: !!this.app.esp32AudioAdapter?.serialOpen },
        wsListening: true,
        inferred: true
      };
    }
    return null;
  }

  syncPythonClient(health) {
    const client = this.app.pythonClient;
    if (!client) return;
    if (health?.status === "ok") {
      client.syncFromHealth(health, this.pythonHttp, this.pythonWs);
      return;
    }
    client.markOffline?.();
  }

  syncEsp32Client(bridgeHealth) {
    const adapter = this.app.esp32AudioAdapter;
    if (!adapter) return;
    if (bridgeHealth) {
      adapter.syncFromBridgeHealth(bridgeHealth, this.bridgeWs);
    }
    if (bridgeHealth?.status === "ok" || bridgeHealth?.wsListening) {
      adapter.ensureConnected();
    }
  }

  updateIntegrationUI(pyHealth, bridgeHealth) {
    const pyPill = document.getElementById("integPythonPill");
    const brPill = document.getElementById("integBridgePill");
    const hint = document.getElementById("integHint");
    const setupList = document.getElementById("integSetupList");

    const pyOk = pyHealth?.status === "ok";
    const wsOpen = !!this.app.esp32AudioAdapter?.isWsOpen?.();
    const serialOpen = bridgeHealth?.serial?.open ?? this.app.esp32AudioAdapter?.serialOpen;
    const bridgeOk = wsOpen && (serialOpen !== false || bridgeHealth?.inferred);

    if (pyPill) {
      pyPill.dataset.state = pyOk ? "connected" : "offline";
      pyPill.textContent = pyOk
        ? `Python · 已连接 (${new URL(this.pythonHttp).port || "8001"})`
        : "Python · 离线";
    }

    if (brPill) {
      if (!wsOpen) {
        brPill.dataset.state = "disconnected";
        brPill.textContent = "ESP32 桥接 · 未连接";
      } else if (serialOpen === false) {
        brPill.dataset.state = "degraded";
        brPill.textContent = "ESP32 桥接 · WS 已连，串口未开";
      } else if (serialOpen) {
        brPill.dataset.state = "connected";
        const port = bridgeHealth?.serial?.port || "";
        brPill.textContent = port
          ? `ESP32 · 已连接 (${port})`
          : "ESP32 桥接 · 已连接 (8765)";
      } else {
        brPill.dataset.state = wsOpen ? "connected" : "disconnected";
        brPill.textContent = wsOpen ? "ESP32 桥接 · 已连接 (8765)" : "ESP32 桥接 · 未连接";
      }
    }

    if (hint) {
      if (!pyOk && !wsOpen) {
        hint.textContent = "Python 与 Bridge 均未就绪。请运行 start-windows.ps1 或 start-mac.sh，页面将自动重连。";
      } else if (!pyOk) {
        hint.textContent = "Python 未运行 — 请启动 python-service。接口将自动校对并重连。";
      } else if (!wsOpen) {
        hint.textContent = "Bridge 未连接 — 请启动 bridge 并插入 ESP32。WebSocket 将自动重试。";
      } else if (serialOpen === false) {
        hint.textContent = "Bridge 已连但串口未打开 — 检查 USB / 关闭 Arduino 串口监视器 / 确认 COM 口。";
      } else {
        hint.textContent = "链路已校对：ESP32 → Bridge → Python → Brush。保存录音或点「分析」即可。";
      }
    }

    if (setupList) {
      const show = !pyOk;
      setupList.classList.toggle("hidden", !show);
      setupList.innerHTML = show
        ? [
            "Windows: .\\start-windows.ps1",
            "Mac: ./start-mac.sh",
            "页面每 3.5s 自动检测并重连"
          ].map((s) => `<li>${s}</li>`).join("")
        : "";
    }
  }

  updatePipelineStatus(pyHealth, bridgeHealth) {
    const pipe = document.getElementById("pipelineStatus");
    if (!pipe) return;

    const pyOk = pyHealth?.status === "ok";
    const pyWs = !!this.app.pythonClient?.connected;
    const espWs = !!this.app.esp32AudioAdapter?.isWsOpen?.();
    const serialOpen = bridgeHealth?.serial?.open ?? this.app.esp32AudioAdapter?.serialOpen;
    const espLive = !!this.app.esp32AudioAdapter?.isActive?.();

    if (pyOk && pyWs && espWs && serialOpen && espLive) {
      pipe.dataset.state = "connected";
      pipe.textContent = "Pipeline · Live";
    } else if (pyOk && espWs && serialOpen) {
      pipe.dataset.state = pyWs ? "connected" : "degraded";
      pipe.textContent = pyWs ? "Pipeline · Ready" : "Pipeline · Python WS…";
    } else if (pyOk) {
      pipe.dataset.state = "degraded";
      pipe.textContent = espWs ? "Pipeline · ESP32 idle" : "Pipeline · No ESP32";
    } else {
      pipe.dataset.state = "offline";
      pipe.textContent = "Pipeline · Offline";
    }
  }
}

window.ServiceConnectionManager = ServiceConnectionManager;
