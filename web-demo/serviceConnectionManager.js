// Auto-probe Python + Bridge, sync API URLs, and keep WebSocket clients connected.
// Wi‑Fi-first: Bridge optional; poll Python /sounds into the library when USB is absent.
class ServiceConnectionManager {
  constructor(app) {
    this.app = app;
    this.pollMs = 3500;
    this._timer = null;
    this._tickInFlight = false;
    this._lastLibrarySyncAt = 0;
    this._librarySyncMs = 8000;
    this._librarySyncInFlight = false;

    const endpoints = (window.PikoServiceEndpoints && window.PikoServiceEndpoints.resolvePythonEndpoints)
      ? window.PikoServiceEndpoints.resolvePythonEndpoints()
      : null;
    const bridgeEp = (window.PikoServiceEndpoints && window.PikoServiceEndpoints.resolveBridgeEndpoints)
      ? window.PikoServiceEndpoints.resolveBridgeEndpoints()
      : null;

    this.pythonHttp = (endpoints && endpoints.http) || "http://127.0.0.1:8001";
    this.pythonWs = (endpoints && endpoints.ws) || "ws://127.0.0.1:8001/ws/audio";
    this.pythonProbeOrder = (endpoints && endpoints.probeOrder) || [
      "http://127.0.0.1:8001",
      "http://localhost:8001"
    ];
    this.bridgeWs = (bridgeEp && bridgeEp.ws) || "ws://127.0.0.1:8765";
    this.bridgeHealthUrls = (bridgeEp && bridgeEp.healthUrls) || [
      "http://127.0.0.1:8766/health",
      "http://localhost:8766/health"
    ];

    this.lastPythonHealth = null;
    this.lastBridgeHealth = null;
    this.lastSyncAt = 0;
  }

  wifiFirst() {
    return !!(window.PikoServiceEndpoints && window.PikoServiceEndpoints.isWifiFirstMode
      && window.PikoServiceEndpoints.isWifiFirstMode());
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

      // Wi‑Fi path: ESP32 POSTs to Python; pull new sounds without USB Bridge events.
      const wsOpen = !!this.app.esp32AudioAdapter?.isWsOpen?.();
      if (pyHealth?.status === "ok" && (!wsOpen || this.wifiFirst())) {
        this.maybeSyncLibraryFromPython();
      }

      this.updateIntegrationUI(pyHealth, bridgeHealth);
      this.updatePipelineStatus(pyHealth, bridgeHealth);
    } catch (err) {
      console.warn("[service] tick failed:", err);
      this.updateIntegrationUI(this.lastPythonHealth, this.lastBridgeHealth);
    } finally {
      this._tickInFlight = false;
    }
  }

  async maybeSyncLibraryFromPython() {
    const now = Date.now();
    if (this._librarySyncInFlight) return;
    if (now - this._lastLibrarySyncAt < this._librarySyncMs) return;
    const client = window.SoundsApiClient;
    if (!client || typeof client.syncIntoApp !== "function" || !this.app) return;

    this._librarySyncInFlight = true;
    this._lastLibrarySyncAt = now;
    try {
      const result = await client.syncIntoApp(this.app, { incremental: true });
      if (result && result.imported > 0) {
        if (typeof client.appendLatestBatch === "function") {
          client.appendLatestBatch(result.importedIds || []);
        }
        if (window.PikoSoundsScreen && typeof window.PikoSoundsScreen.render === "function") {
          window.PikoSoundsScreen.render();
        }
        if (typeof this.app.renderLibrary === "function") this.app.renderLibrary();
        console.info("[service] Wi‑Fi library sync imported", result.imported);
      }
    } catch (err) {
      console.warn("[service] library sync failed:", err);
    } finally {
      this._librarySyncInFlight = false;
    }
  }

  async probePythonHealth() {
    const bases = (this.pythonProbeOrder || []).slice();
    if (this.pythonHttp) bases.unshift(this.pythonHttp);
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
    const helpers = window.PikoServiceEndpoints;
    const claimed = (health && (health.http || health.endpoints?.health?.replace(/\/health\/?$/, ""))) || "";
    let http = fetchedBase || this.pythonHttp;
    // Prefer the URL we actually reached. Ignore loopback claims from a remote host's /health.
    if (claimed) {
      const claimedLoop = helpers ? helpers.isLoopbackHttp(claimed) : /127\.0\.0\.1|localhost/i.test(claimed);
      const fetchedLoop = helpers ? helpers.isLoopbackHttp(fetchedBase || "") : true;
      if (!claimedLoop || fetchedLoop) {
        http = claimed.replace(/\/$/, "");
      }
    }
    if (fetchedBase) http = String(fetchedBase).replace(/\/$/, "");

    let ws = health?.endpoints?.wsAudio || health?.ws || this.pythonWs;
    if (helpers && helpers.httpToWs) {
      const derived = helpers.httpToWs(http);
      const wsLoop = /127\.0\.0\.1|localhost/i.test(String(ws || ""));
      const httpLoop = helpers.isLoopbackHttp(http);
      if (!ws || (wsLoop && !httpLoop) || derived) {
        ws = derived || ws;
      }
    }
    if (http) this.pythonHttp = http.replace(/\/$/, "");
    if (ws) this.pythonWs = ws;
    if (this.app) this.app.pythonBaseUrl = this.pythonHttp;
  }

  async probeBridgeHealth() {
    // Refresh health URL list in case localStorage/query changed.
    if (window.PikoServiceEndpoints?.resolveBridgeEndpoints) {
      const ep = window.PikoServiceEndpoints.resolveBridgeEndpoints();
      if (ep?.ws) this.bridgeWs = ep.ws;
      if (ep?.healthUrls?.length) this.bridgeHealthUrls = ep.healthUrls;
    }

    for (const url of this.bridgeHealthUrls) {
      try {
        const data = await this._fetchJson(url, 3000);
        if (data?.ws) {
          // Prefer non-loopback ws when page is on LAN.
          const helpers = window.PikoServiceEndpoints;
          const claimed = String(data.ws);
          const claimedLoop = helpers ? helpers.isLoopbackHttp(claimed.replace(/^ws/i, "http"))
            : /127\.0\.0\.1|localhost/i.test(claimed);
          if (!claimedLoop || !(helpers && helpers.pageIsLanHost && helpers.pageIsLanHost())) {
            this.bridgeWs = claimed;
          } else if (helpers?.resolveBridgeEndpoints) {
            this.bridgeWs = helpers.resolveBridgeEndpoints().ws || claimed;
          } else {
            this.bridgeWs = claimed;
          }
        }
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
    const wifiLive = !!this.app.esp32AudioAdapter?.isWifiLive?.();
    const serialOpen = bridgeHealth?.serial?.open ?? this.app.esp32AudioAdapter?.serialOpen;
    const wifiFirst = this.wifiFirst();
    const bridgeOk = wsOpen && (serialOpen !== false || bridgeHealth?.inferred);

    // Keep discovering ESP32 Wi‑Fi control plane while Python is up.
    if (pyOk && !wsOpen) {
      this.app.esp32AudioAdapter?.ensureWifiTransport?.();
    }

    if (pyPill) {
      pyPill.dataset.state = pyOk ? "connected" : "offline";
      try {
        const port = new URL(this.pythonHttp).port || "8001";
        pyPill.textContent = pyOk
          ? `Python · 已连接 (${port})`
          : "Python · 离线";
      } catch (_) {
        pyPill.textContent = pyOk ? "Python · 已连接" : "Python · 离线";
      }
    }

    if (brPill) {
      if (wifiLive && !wsOpen) {
        brPill.dataset.state = "connected";
        const base = this.app.esp32AudioAdapter?.wifiBase || "";
        brPill.textContent = base
          ? `ESP32 · Wi‑Fi 实时 (${base.replace(/^https?:\/\//, "")})`
          : "ESP32 · Wi‑Fi 实时波形";
      } else if (wifiFirst && !wsOpen) {
        brPill.dataset.state = pyOk ? "degraded" : "disconnected";
        brPill.textContent = pyOk
          ? "ESP32 · 等待 Wi‑Fi /metrics…"
          : "ESP32 · 未连接";
      } else if (!wsOpen) {
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
      if (wifiLive && !wsOpen) {
        hint.textContent = "Wi‑Fi 实时：波形来自 ESP32 /metrics；网页 Start/Stop 经 HTTP 控制设备；录完自动上传并同步库。";
      } else if (wifiFirst && pyOk && !wsOpen) {
        hint.textContent = "正在寻找 ESP32 Wi‑Fi（/esp32 announce 或 piko-esp.local:8080）。也可 ?esp32=http://<ESP-IP>:8080";
      } else if (!pyOk && !wsOpen) {
        hint.textContent = "Python 与 Bridge 均未就绪。请运行 start-windows.ps1 或 start-mac.sh；iPad 请用 http://<Mac热点IP>:8000 打开。";
      } else if (!pyOk) {
        hint.textContent = "Python 未运行 — 请启动 python-service（须绑定 0.0.0.0 供热点访问）。";
      } else if (!wsOpen) {
        hint.textContent = "Bridge 未连接 — 若 ESP32 已上热点，页面会自动改走 Wi‑Fi 实时与启停。";
      } else if (serialOpen === false) {
        hint.textContent = "Bridge 已连但串口未打开 — 检查 USB / 关闭 Arduino 串口监视器 / 确认 COM 口。";
      } else {
        hint.textContent = bridgeOk
          ? "链路已校对：ESP32 → Bridge → Python → Brush。保存录音或点「分析」即可。"
          : "Python 已连接。";
      }
    }

    if (setupList) {
      const show = !pyOk;
      setupList.classList.toggle("hidden", !show);
      setupList.innerHTML = show
        ? [
            "Windows: .\\start-windows.ps1（Python 现绑定 0.0.0.0）",
            "Mac: ./start-mac.sh",
            "iPad / 热点: 浏览器打开 http://<Mac-IP>:8000",
            "可选: ?api=http://<Mac-IP>:8001&esp32=http://<ESP-IP>:8080"
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
    const wifiLive = !!this.app.esp32AudioAdapter?.isWifiLive?.();
    const serialOpen = bridgeHealth?.serial?.open ?? this.app.esp32AudioAdapter?.serialOpen;
    const espLive = !!this.app.esp32AudioAdapter?.isActive?.();
    const wifiFirst = this.wifiFirst();

    if (pyOk && pyWs && espWs && serialOpen && espLive) {
      pipe.dataset.state = "connected";
      pipe.textContent = "Pipeline · Live";
    } else if (pyOk && wifiLive) {
      pipe.dataset.state = "connected";
      pipe.textContent = "Pipeline · Wi‑Fi Live";
    } else if (pyOk && espWs && serialOpen) {
      pipe.dataset.state = pyWs ? "connected" : "degraded";
      pipe.textContent = pyWs ? "Pipeline · Ready" : "Pipeline · Python WS…";
    } else if (pyOk && (wifiFirst || !espWs)) {
      pipe.dataset.state = "degraded";
      pipe.textContent = "Pipeline · Wi‑Fi sync";
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
