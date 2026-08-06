/**
 * Piko Sounds API client — Python :8001 → Supabase / local sounds store.
 */
(function () {
  'use strict';

  var DEFAULT_BASE = 'http://127.0.0.1:8001';
  var lastBackendStatus = null;

  function baseUrl() {
    if (window.App && window.App.pythonBaseUrl) return window.App.pythonBaseUrl;
    if (window.PYTHON_SERVICE_URL) return String(window.PYTHON_SERVICE_URL).replace(/\/$/, '');
    return DEFAULT_BASE;
  }

  async function listSounds() {
    var ctrl = new AbortController();
    var t = setTimeout(function () { ctrl.abort(); }, 8000);
    try {
      var res = await fetch(baseUrl() + '/sounds', { cache: 'no-store', signal: ctrl.signal });
      if (!res.ok) throw new Error('GET /sounds failed: ' + res.status);
      var data = await res.json();
      lastBackendStatus = data.backend || lastBackendStatus;
      return Array.isArray(data.sounds) ? data.sounds : [];
    } finally {
      clearTimeout(t);
    }
  }

  async function getSound(id) {
    var res = await fetch(baseUrl() + '/sounds/' + encodeURIComponent(id), { cache: 'no-store' });
    if (!res.ok) throw new Error('GET /sounds/' + id + ' failed: ' + res.status);
    var data = await res.json();
    return data.sound || null;
  }

  function audioUrl(id) {
    return baseUrl() + '/sounds/' + encodeURIComponent(id) + '/audio';
  }

  async function fetchAudioBlob(id) {
    var res = await fetch(audioUrl(id), { cache: 'no-store' });
    if (!res.ok) throw new Error('GET audio failed: ' + res.status);
    return await res.blob();
  }

  async function deleteSound(id) {
    if (!id) throw new Error('deleteSound: missing id');
    var res = await fetch(baseUrl() + '/sounds/' + encodeURIComponent(id), {
      method: 'DELETE',
      cache: 'no-store'
    });
    if (res.status === 404) return { status: 'missing', id: id };
    if (!res.ok) throw new Error('DELETE /sounds/' + id + ' failed: ' + res.status);
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
      lastBackendStatus = data.supabase || null;
      return lastBackendStatus;
    } finally {
      clearTimeout(t);
    }
  }

  function formatBackendHint(st) {
    if (!st) return 'Storage: unknown (Python :8001 unreachable?)';
    var backend = st.backend || (st.configured ? 'supabase' : 'local');
    if (backend === 'supabase') {
      return 'Storage: Supabase · cloud (browser cache is IndexedDB only)';
    }
    var dir = st.localDir || '';
    var short = dir;
    if (dir.length > 64) {
      short = '…' + dir.slice(-56);
    }
    var n = typeof st.localCount === 'number' ? st.localCount : '?';
    return 'Storage: local · ' + n + ' files · ' + short;
  }

  /**
   * Import remote sounds into App.soundLibrary (skip existing backend ids).
   * Returns { imported, importedIds, total, backend }.
   */
  async function syncIntoApp(app) {
    if (!app || typeof app.addFile !== 'function') {
      throw new Error('App.addFile unavailable');
    }
    var rows = await listSounds();
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

    return {
      imported: imported,
      importedIds: importedIds,
      total: rows.length,
      sounds: rows,
      backend: lastBackendStatus
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
    listSounds: listSounds,
    getSound: getSound,
    audioUrl: audioUrl,
    fetchAudioBlob: fetchAudioBlob,
    deleteSound: deleteSound,
    syncIntoApp: syncIntoApp,
    fetchBackendStatus: fetchBackendStatus,
    formatBackendHint: formatBackendHint,
    getLastBackendStatus: function () { return lastBackendStatus; },
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
