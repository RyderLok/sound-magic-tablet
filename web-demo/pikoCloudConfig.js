/**
 * Cloud / remote service config for iPad + desktop + LAN hotspot.
 *
 * Resolution order for API / Bridge (highest wins):
 *   1. URL query: ?api=http://HOST:8001&bridge=ws://HOST:8765&esp32=http://HOST
 *   2. localStorage: piko.apiBase / piko.bridgeWs / piko.esp32Base
 *   3. window.PIKO_SUPABASE.analysisBaseUrl (remote / tunnel)
 *   4. Same-host LAN defaults when page is opened via LAN IP (not localhost)
 *   5. Desktop loopback http://127.0.0.1:8001 + ws://127.0.0.1:8765
 *
 * Wi‑Fi-first product mode (no USB Bridge): Python on LAN is enough —
 * ESP32 uploads PCM via Wi‑Fi; UI syncs library from GET /sounds.
 * Live FieldRecorder waveform is degraded (device TFT / post-upload preview).
 *
 * NEVER put SILICONFLOW_API_KEY or SUPABASE service_role in this file.
 */
window.PIKO_SUPABASE = window.PIKO_SUPABASE || {
  url: '',
  anonKey: '',
  bucket: 'sounds',
  /** Optional Cloudflare / hosted API base for remote iPad pages */
  analysisBaseUrl: ''
};

(function () {
  'use strict';

  var LS_API = 'piko.apiBase';
  var LS_BRIDGE = 'piko.bridgeWs';
  var LS_ESP32 = 'piko.esp32Base';

  function trimSlash(u) {
    return String(u || '').trim().replace(/\/$/, '');
  }

  function isLoopbackHost(hostname) {
    var h = String(hostname || '').toLowerCase();
    return h === '127.0.0.1' || h === 'localhost' || h === '::1' || h === '';
  }

  function isLoopbackHttp(url) {
    try {
      var u = new URL(url);
      return isLoopbackHost(u.hostname);
    } catch (e) {
      return /127\.0\.0\.1|localhost/i.test(String(url || ''));
    }
  }

  function pageIsLocalDev() {
    return isLoopbackHost((location && location.hostname) || '');
  }

  /** Page served from a LAN / hotspot IP (typical iPad Safari → Mac :8000). */
  function pageIsLanHost() {
    var h = (location && location.hostname) || '';
    if (isLoopbackHost(h)) return false;
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return true;
    // *.local mDNS
    return /\.local$/i.test(h);
  }

  function httpToWs(httpBase, path) {
    var base = trimSlash(httpBase);
    if (!base) return '';
    var suffix = path || '/ws/audio';
    if (base.indexOf('https://') === 0) return 'wss://' + base.slice(8) + suffix;
    if (base.indexOf('http://') === 0) return 'ws://' + base.slice(7) + suffix;
    return '';
  }

  function qsParam(name) {
    try {
      return new URLSearchParams(location.search).get(name);
    } catch (e) {
      return null;
    }
  }

  function readStorage(key) {
    try {
      return trimSlash(localStorage.getItem(key) || '');
    } catch (e) {
      return '';
    }
  }

  function writeStorage(key, value) {
    try {
      var v = trimSlash(value);
      if (!v) localStorage.removeItem(key);
      else localStorage.setItem(key, v);
    } catch (e) { /* noop */ }
  }

  function pageOriginHttp(port) {
    var h = (location && location.hostname) || '';
    if (!h || isLoopbackHost(h)) return '';
    var proto = (location && location.protocol === 'https:') ? 'https:' : 'http:';
    return proto + '//' + h + (port ? (':' + port) : '');
  }

  /**
   * Persist endpoints from query string once, then strip is left to the caller.
   * Supports: ?api= &bridge= &esp32=
   */
  function ingestQueryOverrides() {
    var api = qsParam('api');
    var bridge = qsParam('bridge');
    var esp32 = qsParam('esp32');
    if (api) writeStorage(LS_API, api);
    if (bridge) writeStorage(LS_BRIDGE, bridge);
    if (esp32) writeStorage(LS_ESP32, esp32);
    return {
      api: api ? trimSlash(api) : '',
      bridge: bridge ? trimSlash(bridge) : '',
      esp32: esp32 ? trimSlash(esp32) : ''
    };
  }

  function resolvePythonEndpoints() {
    ingestQueryOverrides();
    var cfg = window.PIKO_SUPABASE || {};
    var remote = trimSlash(cfg.analysisBaseUrl || window.PIKO_ANALYSIS_URL || '');
    var fromQsOrLs = trimSlash(qsParam('api') || readStorage(LS_API) || '');
    var lanHttp = pageIsLanHost() ? pageOriginHttp(8001) : '';
    var localHttp = 'http://127.0.0.1:8001';
    var localAlt = 'http://localhost:8001';
    var local = pageIsLocalDev();

    var preferredHttp = fromQsOrLs
      || (local ? localHttp : (remote || lanHttp || localHttp));

    var probeOrder = [];
    function push(u) {
      u = trimSlash(u);
      if (u && probeOrder.indexOf(u) < 0) probeOrder.push(u);
    }
    push(fromQsOrLs);
    if (local) {
      push(localHttp);
      push(localAlt);
      push(lanHttp);
      push(remote);
    } else {
      push(remote);
      push(lanHttp);
      push(fromQsOrLs);
      push(localHttp);
      push(localAlt);
    }

    return {
      http: preferredHttp,
      ws: httpToWs(preferredHttp),
      remote: remote || null,
      remoteWs: remote ? httpToWs(remote) : null,
      probeOrder: probeOrder,
      pageIsLocal: local,
      pageIsLan: pageIsLanHost(),
      configured: !!fromQsOrLs
    };
  }

  function resolveBridgeEndpoints() {
    ingestQueryOverrides();
    var fromQsOrLs = trimSlash(qsParam('bridge') || readStorage(LS_BRIDGE) || '');
    var lanHost = pageIsLanHost() ? ((location && location.hostname) || '') : '';
    var lanWs = lanHost ? ('ws://' + lanHost + ':8765') : '';
    var localWs = 'ws://127.0.0.1:8765';
    var localAlt = 'ws://localhost:8765';
    var preferred = fromQsOrLs || (pageIsLocalDev() ? localWs : (lanWs || localWs));

    var healthUrls = [];
    function pushHealth(wsUrl) {
      try {
        var u = new URL(wsUrl.replace(/^ws/i, 'http'));
        var base = u.protocol + '//' + u.hostname + ':8766/health';
        if (healthUrls.indexOf(base) < 0) healthUrls.push(base);
      } catch (e) { /* noop */ }
    }
    pushHealth(preferred);
    if (lanWs) pushHealth(lanWs);
    pushHealth(localWs);
    pushHealth(localAlt);

    return {
      ws: preferred,
      healthUrls: healthUrls,
      pageIsLan: pageIsLanHost(),
      configured: !!fromQsOrLs
    };
  }

  function resolveEsp32HttpBase() {
    ingestQueryOverrides();
    return trimSlash(qsParam('esp32') || readStorage(LS_ESP32) || window.PIKO_ESP32_URL || '');
  }

  /** True when we expect Wi‑Fi upload path (no reliance on USB live PCM). */
  function isWifiFirstMode() {
    if (resolveEsp32HttpBase()) return true;
    if (!pageIsLocalDev()) return true;
    try {
      return localStorage.getItem('piko.wifiFirst') === '1';
    } catch (e) {
      return false;
    }
  }

  function setWifiFirst(enabled) {
    try {
      if (enabled) localStorage.setItem('piko.wifiFirst', '1');
      else localStorage.removeItem('piko.wifiFirst');
    } catch (e) { /* noop */ }
  }

  window.PikoServiceEndpoints = {
    trimSlash: trimSlash,
    isLoopbackHttp: isLoopbackHttp,
    isLoopbackHost: isLoopbackHost,
    pageIsLocalDev: pageIsLocalDev,
    pageIsLanHost: pageIsLanHost,
    httpToWs: httpToWs,
    resolvePythonEndpoints: resolvePythonEndpoints,
    resolveBridgeEndpoints: resolveBridgeEndpoints,
    resolveEsp32HttpBase: resolveEsp32HttpBase,
    isWifiFirstMode: isWifiFirstMode,
    setWifiFirst: setWifiFirst,
    ingestQueryOverrides: ingestQueryOverrides,
    saveApiBase: function (v) { writeStorage(LS_API, v); },
    saveBridgeWs: function (v) { writeStorage(LS_BRIDGE, v); },
    saveEsp32Base: function (v) { writeStorage(LS_ESP32, v); }
  };
})();
