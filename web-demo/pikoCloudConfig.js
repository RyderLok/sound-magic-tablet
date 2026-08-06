/**
 * Cloud / remote service config for iPad + desktop.
 *
 * Desktop on this Mac: localhost still preferred when you open http://127.0.0.1:8000
 * iPad: open the web-demo trycloudflare URL; analysisBaseUrl points at the API tunnel.
 *
 * Tunnel is temporary (Mac must stay on). For permanent hosting use Dockerfile + Fly/Railway.
 * NEVER put SILICONFLOW_API_KEY or SUPABASE service_role in this file.
 */
window.PIKO_SUPABASE = window.PIKO_SUPABASE || {
  url: '',
  anonKey: '',
  bucket: 'sounds',
  /** Live Cloudflare quick tunnel → this Mac's Python :8001 (Qwen /analyze/wav) */
  analysisBaseUrl: 'https://seal-superb-dash-instruction.trycloudflare.com'
};

(function () {
  'use strict';

  function trimSlash(u) {
    return String(u || '').trim().replace(/\/$/, '');
  }

  function isLoopbackHttp(url) {
    try {
      var u = new URL(url);
      return u.hostname === '127.0.0.1' || u.hostname === 'localhost';
    } catch (e) {
      return /127\.0\.0\.1|localhost/i.test(String(url || ''));
    }
  }

  function pageIsLocalDev() {
    var h = (location && location.hostname) || '';
    return h === '127.0.0.1' || h === 'localhost' || h === '';
  }

  function httpToWs(httpBase) {
    var base = trimSlash(httpBase);
    if (!base) return '';
    if (base.indexOf('https://') === 0) return 'wss://' + base.slice(8) + '/ws/audio';
    if (base.indexOf('http://') === 0) return 'ws://' + base.slice(7) + '/ws/audio';
    return '';
  }

  /**
   * Resolve Python/Qwen analysis endpoints.
   * Local page → prefer :8001 (current desktop). Remote page (iPad) → prefer analysisBaseUrl.
   */
  function resolvePythonEndpoints() {
    var cfg = window.PIKO_SUPABASE || {};
    var remote = trimSlash(cfg.analysisBaseUrl || window.PIKO_ANALYSIS_URL || '');
    var localHttp = 'http://127.0.0.1:8001';
    var localAlt = 'http://localhost:8001';
    var local = pageIsLocalDev();

    var probeOrder = [];
    if (local) {
      probeOrder.push(localHttp, localAlt);
      if (remote) probeOrder.push(remote);
    } else {
      if (remote) probeOrder.push(remote);
      probeOrder.push(localHttp, localAlt);
    }

    var preferredHttp = local ? localHttp : (remote || localHttp);
    return {
      http: preferredHttp,
      ws: httpToWs(preferredHttp),
      remote: remote || null,
      remoteWs: remote ? httpToWs(remote) : null,
      probeOrder: probeOrder.filter(Boolean),
      pageIsLocal: local
    };
  }

  window.PikoServiceEndpoints = {
    trimSlash: trimSlash,
    isLoopbackHttp: isLoopbackHttp,
    pageIsLocalDev: pageIsLocalDev,
    httpToWs: httpToWs,
    resolvePythonEndpoints: resolvePythonEndpoints
  };
})();
