/**
 * Piko Sounds API client
 *
 * Desktop (default, unchanged): Python :8001 → Supabase / local.
 * iPad / offline Python: optional direct Supabase read via window.PIKO_SUPABASE
 *   (anon key only). Upload / delete still go through Python when available.
 */
(function () {
  'use strict';

  var DEFAULT_BASE = 'http://127.0.0.1:8001';
  var lastBackendStatus = null;
  var lastTransport = 'python'; // 'python' | 'cloud'
  var lastSyncCursorKey = 'piko.soundsSyncCursor';

  function baseUrl() {
    if (window.App && window.App.pythonBaseUrl) return window.App.pythonBaseUrl;
    if (window.PYTHON_SERVICE_URL) return String(window.PYTHON_SERVICE_URL).replace(/\/$/, '');
    if (window.PikoServiceEndpoints && typeof window.PikoServiceEndpoints.resolvePythonEndpoints === 'function') {
      var ep = window.PikoServiceEndpoints.resolvePythonEndpoints();
      if (ep && ep.http) return ep.http;
    }
    return DEFAULT_BASE;
  }

  function readSyncCursor() {
    try {
      return String(localStorage.getItem(lastSyncCursorKey) || '').trim();
    } catch (e) {
      return '';
    }
  }

  function writeSyncCursor(iso) {
    if (!iso) return;
    try {
      localStorage.setItem(lastSyncCursorKey, String(iso));
    } catch (e) { /* noop */ }
  }

  function cloudConfig() {
    var cfg = window.PIKO_SUPABASE || null;
    if (!cfg) return null;
    var url = String(cfg.url || '').trim().replace(/\/$/, '');
    var anonKey = String(cfg.anonKey || cfg.anon_key || '').trim();
    var bucket = String(cfg.bucket || 'sounds').trim() || 'sounds';
    if (!url || !anonKey) return null;
    return { url: url, anonKey: anonKey, bucket: bucket };
  }

  function cloudHeaders(cfg) {
    return {
      apikey: cfg.anonKey,
      Authorization: 'Bearer ' + cfg.anonKey
    };
  }

  function markPython(status) {
    lastTransport = 'python';
    if (status) lastBackendStatus = status;
  }

  function markCloud() {
    lastTransport = 'cloud';
    var cfg = cloudConfig();
    lastBackendStatus = {
      configured: true,
      backend: 'supabase',
      sourceOfTruth: 'supabase',
      transport: 'cloud-direct',
      bucket: cfg && cfg.bucket,
      hint: 'Reading Supabase directly (Python :8001 unreachable). Upload still needs a writer (desktop Python or future iPad upload).'
    };
  }

  async function listSoundsPython(opts) {
    var ctrl = new AbortController();
    var t = setTimeout(function () { ctrl.abort(); }, 8000);
    try {
      var q = '';
      var since = opts && opts.since;
      if (since) q = '?since=' + encodeURIComponent(since);
      var res = await fetch(baseUrl() + '/sounds' + q, { cache: 'no-store', signal: ctrl.signal });
      if (!res.ok) throw new Error('GET /sounds failed: ' + res.status);
      var data = await res.json();
      markPython(data.backend || lastBackendStatus);
      return Array.isArray(data.sounds) ? data.sounds : [];
    } finally {
      clearTimeout(t);
    }
  }

  async function listSoundsCloud() {
    var cfg = cloudConfig();
    if (!cfg) throw new Error('Cloud config missing (set window.PIKO_SUPABASE)');
    var res = await fetch(
      cfg.url + '/rest/v1/sounds?select=*&order=created_at.desc',
      { cache: 'no-store', headers: Object.assign({ Accept: 'application/json' }, cloudHeaders(cfg)) }
    );
    if (!res.ok) throw new Error('Supabase list failed: ' + res.status);
    var rows = await res.json();
    markCloud();
    return Array.isArray(rows) ? rows : [];
  }

  async function listSounds(opts) {
    try {
      return await listSoundsPython(opts || null);
    } catch (err) {
      if (!cloudConfig()) throw err;
      console.warn('[sounds] Python list failed, trying Supabase direct:', err && err.message);
      return await listSoundsCloud();
    }
  }

  async function getSoundPython(id) {
    var res = await fetch(baseUrl() + '/sounds/' + encodeURIComponent(id), { cache: 'no-store' });
    if (!res.ok) throw new Error('GET /sounds/' + id + ' failed: ' + res.status);
    var data = await res.json();
    markPython(lastBackendStatus);
    return data.sound || null;
  }

  async function getSoundCloud(id) {
    var cfg = cloudConfig();
    if (!cfg) throw new Error('Cloud config missing');
    var res = await fetch(
      cfg.url + '/rest/v1/sounds?id=eq.' + encodeURIComponent(id) + '&select=*',
      { cache: 'no-store', headers: Object.assign({ Accept: 'application/json' }, cloudHeaders(cfg)) }
    );
    if (!res.ok) throw new Error('Supabase get failed: ' + res.status);
    var rows = await res.json();
    markCloud();
    return Array.isArray(rows) && rows[0] ? rows[0] : null;
  }

  async function getSound(id) {
    try {
      return await getSoundPython(id);
    } catch (err) {
      if (!cloudConfig()) throw err;
      return await getSoundCloud(id);
    }
  }

  function audioUrl(id) {
    // Prefer Python proxy URL (works with private bucket via service role).
    return baseUrl() + '/sounds/' + encodeURIComponent(id) + '/audio';
  }

  async function fetchAudioBlobPython(id) {
    var res = await fetch(audioUrl(id), { cache: 'no-store' });
    if (!res.ok) throw new Error('GET audio failed: ' + res.status);
    markPython(lastBackendStatus);
    return await res.blob();
  }

  async function fetchAudioBlobCloud(id) {
    var cfg = cloudConfig();
    if (!cfg) throw new Error('Cloud config missing');
    var row = await getSoundCloud(id);
    if (!row || !row.storage_path) throw new Error('Sound missing storage_path');
    var res = await fetch(
      cfg.url + '/storage/v1/object/' + encodeURIComponent(cfg.bucket) + '/' + String(row.storage_path).replace(/^\/+/, ''),
      { cache: 'no-store', headers: cloudHeaders(cfg) }
    );
    if (!res.ok) throw new Error('Supabase audio failed: ' + res.status);
    markCloud();
    return await res.blob();
  }

  async function fetchAudioBlob(id) {
    try {
      return await fetchAudioBlobPython(id);
    } catch (err) {
      if (!cloudConfig()) throw err;
      console.warn('[sounds] Python audio failed, trying Supabase direct:', err && err.message);
      return await fetchAudioBlobCloud(id);
    }
  }

  async function deleteSound(id) {
    if (!id) throw new Error('deleteSound: missing id');
    // Writes stay on Python (service role). Cloud-direct delete not enabled for anon.
    var res = await fetch(baseUrl() + '/sounds/' + encodeURIComponent(id), {
      method: 'DELETE',
      cache: 'no-store'
    });
    if (res.status === 404) return { status: 'missing', id: id };
    if (!res.ok) throw new Error('DELETE /sounds/' + id + ' failed: ' + res.status);
    markPython(lastBackendStatus);
    try {
      return await res.json();
    } catch (e) {
      return { status: 'ok', id: id };
    }
  }

  async function fetchBackendStatus() {
    var ctrl = new AbortController();
    var t = setTimeout(function () { ctrl.abort(); }, 5000);
    try {
      var res = await fetch(baseUrl() + '/health', { cache: 'no-store', signal: ctrl.signal });
      if (!res.ok) throw new Error('GET /health failed: ' + res.status);
      var data = await res.json();
      markPython(data.supabase || null);
      if (lastBackendStatus && typeof lastBackendStatus === 'object') {
        lastBackendStatus = Object.assign({}, lastBackendStatus, { transport: 'python' });
      }
      return lastBackendStatus;
    } catch (err) {
      if (cloudConfig()) {
        markCloud();
        return lastBackendStatus;
      }
      throw err;
    } finally {
      clearTimeout(t);
    }
  }

  function formatBackendHint(st) {
    if (!st) {
      return cloudConfig()
        ? 'Storage: Supabase ready (fill policies) · Python :8001 unreachable'
        : 'Storage: unknown (Python :8001 unreachable?)';
    }
    var transport = st.transport || lastTransport;
    var backend = st.backend || (st.configured ? 'supabase' : 'local');
    if (backend === 'supabase') {
      if (transport === 'cloud-direct' || transport === 'cloud') {
        return 'Storage: Supabase · direct read (desktop upload still via Python)';
      }
      return 'Storage: Supabase · cloud (browser cache is IndexedDB only)';
    }
    var dir = st.localDir || '';
    var short = dir;
    if (dir.length > 64) {
      short = '…' + dir.slice(-56);
    }
    var n = typeof st.localCount === 'number' ? st.localCount : '?';
    return 'Storage: local · ' + n + ' files · shared via Python LAN (iPad sync OK) · ' + short;
  }

  /**
   * Import remote sounds into App.soundLibrary (skip existing backend ids).
   * Cross-device: iPad / desktop share Python (or Supabase) as source of truth.
   * Returns { imported, importedIds, total, backend }.
   */
  async function syncIntoApp(app, opts) {
    if (!app || typeof app.addFile !== 'function') {
      throw new Error('App.addFile unavailable');
    }
    var incremental = !!(opts && opts.incremental);
    var since = incremental ? readSyncCursor() : '';
    var rows = await listSounds(since ? { since: since } : null);
    // First sync or empty cursor: full list. Keep cursor at newest created_at.
    var newest = since;
    var imported = 0;
    var importedIds = [];
    var existing = new Set(
      (app.soundLibrary || [])
        .map(function (s) { return s.backendId || s.id; })
        .filter(Boolean)
    );

    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (!row || !row.id) continue;
      if (row.created_at && (!newest || String(row.created_at) > newest)) {
        newest = String(row.created_at);
      }
      if (existing.has(row.id)) continue;
      if (row.upload_status && row.upload_status !== 'uploaded') continue;

      var blob = await fetchAudioBlob(row.id);
      var file = new File([blob], (row.name || 'sound') + '.wav', { type: 'audio/wav' });
      var sample = await app.addFile(file, {
        displayName: row.name || ('sound' + (i + 1)),
        source: row.source || 'esp32',
        backendId: row.id,
        skipPersist: false
      });
      if (sample) {
        sample.backendId = row.id;
        sample.createdAt = row.created_at
          ? Date.parse(row.created_at) || sample.createdAt
          : sample.createdAt;
        if (row.duration_ms > 0) {
          sample.duration = row.duration_ms / 1000;
        }
        if (typeof app.persistSample === 'function') app.persistSample(sample);
        existing.add(row.id);
        importedIds.push(sample.id);
        imported += 1;
      }
    }

    if (newest) writeSyncCursor(newest);

    return {
      imported: imported,
      importedIds: importedIds,
      total: rows.length,
      sounds: rows,
      backend: lastBackendStatus,
      transport: lastTransport,
      since: since || null
    };
  }

  /** 仅 Collect→Transfer 本次新导入进 New Sounds；其余一律 My sounds 历史 */
  var LATEST_BATCH_KEY = 'piko.latestSoundBatchIds';

  function loadLatestBatch() {
    try {
      var raw = localStorage.getItem(LATEST_BATCH_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr.filter(Boolean) : [];
    } catch (e) {
      return [];
    }
  }

  function setLatestBatch(ids) {
    var unique = [];
    var seen = {};
    (ids || []).forEach(function (id) {
      if (!id || seen[id]) return;
      seen[id] = true;
      unique.push(String(id));
    });
    try {
      localStorage.setItem(LATEST_BATCH_KEY, JSON.stringify(unique));
    } catch (e) { /* noop */ }
    return unique;
  }

  function pruneLatestBatch(lib) {
    var list = Array.isArray(lib) ? lib : [];
    var batch = loadLatestBatch();
    if (!batch.length) return batch;
    var alive = batch.filter(function (id) {
      return list.some(function (s) {
        return s && (s.id === id || s.backendId === id);
      });
    });
    if (alive.length !== batch.length) setLatestBatch(alive);
    return alive;
  }

  /** 进入 Transfer：清空 New Sounds，旧批次全部回到历史 */
  function beginTransferSession() {
    return setLatestBatch([]);
  }

  /**
   * Transfer 同步结束：New Sounds = 本次新导入；
   * 若已在库里（硬件上传时已 sync），回填后端最近录音，避免空列表。
   */
  function commitTransferBatch(app, syncResult) {
    var ids = (syncResult && syncResult.importedIds) || [];
    if (ids.length) return setLatestBatch(ids);

    var rows = (syncResult && syncResult.sounds) || [];
    var lib = (app && app.soundLibrary) || [];
    if (!rows.length || !lib.length) return setLatestBatch([]);

    var byBackend = Object.create(null);
    lib.forEach(function (s) {
      if (s && s.backendId) byBackend[s.backendId] = s.id;
    });

    var sorted = rows.slice().sort(function (a, b) {
      return Date.parse(b.created_at || 0) - Date.parse(a.created_at || 0);
    });

    var picked = [];
    for (var i = 0; i < sorted.length && picked.length < 8; i++) {
      var row = sorted[i];
      if (!row || !row.id) continue;
      var localId = byBackend[row.id];
      if (localId) picked.push(localId);
    }
    return setLatestBatch(picked);
  }

  /** 硬件上传后：把本次新导入追加进 New Sounds（不整批覆盖） */
  function appendLatestBatch(ids) {
    if (!ids || !ids.length) return loadLatestBatch();
    return setLatestBatch(loadLatestBatch().concat(ids));
  }

  function sampleInBatch(sample, batchSet) {
    if (!sample || !batchSet) return false;
    if (batchSet[sample.id]) return true;
    if (sample.backendId && batchSet[sample.backendId]) return true;
    return false;
  }

  function batchSetFromIds(ids) {
    var set = Object.create(null);
    (ids || []).forEach(function (id) { set[id] = true; });
    return set;
  }

  function listLatestSamples(app) {
    var lib = (app && app.soundLibrary) || [];
    var batch = pruneLatestBatch(lib);
    if (!batch.length) return [];
    var set = batchSetFromIds(batch);
    return lib.filter(function (s) { return sampleInBatch(s, set); });
  }

  function listHistorySamples(app) {
    var lib = (app && app.soundLibrary) || [];
    var batch = pruneLatestBatch(lib);
    if (!batch.length) return lib.slice();
    var set = batchSetFromIds(batch);
    return lib.filter(function (s) { return !sampleInBatch(s, set); });
  }

  function forgetFromLatestBatch(sampleId, backendId) {
    var batch = loadLatestBatch().filter(function (id) {
      return id !== sampleId && id !== backendId;
    });
    return setLatestBatch(batch);
  }

  window.SoundsApiClient = {
    baseUrl: baseUrl,
    cloudConfig: cloudConfig,
    listSounds: listSounds,
    getSound: getSound,
    audioUrl: audioUrl,
    fetchAudioBlob: fetchAudioBlob,
    deleteSound: deleteSound,
    syncIntoApp: syncIntoApp,
    fetchBackendStatus: fetchBackendStatus,
    formatBackendHint: formatBackendHint,
    getLastBackendStatus: function () { return lastBackendStatus; },
    getLastTransport: function () { return lastTransport; },
    loadLatestBatch: loadLatestBatch,
    setLatestBatch: setLatestBatch,
    beginTransferSession: beginTransferSession,
    commitTransferBatch: commitTransferBatch,
    appendLatestBatch: appendLatestBatch,
    listLatestSamples: listLatestSamples,
    listHistorySamples: listHistorySamples,
    forgetFromLatestBatch: forgetFromLatestBatch
  };
})();
