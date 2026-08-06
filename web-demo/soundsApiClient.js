/**
 * Piko Sounds API client — Python :8001 → Supabase / local sounds store.
 */
(function () {
  'use strict';

  var DEFAULT_BASE = 'http://127.0.0.1:8001';

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

  /**
   * Import remote sounds into App.soundLibrary (skip existing backend ids).
   * Returns { imported, total }.
   */
  async function syncIntoApp(app) {
    if (!app || typeof app.addFile !== 'function') {
      throw new Error('App.addFile unavailable');
    }
    var rows = await listSounds();
    var imported = 0;
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
        imported += 1;
      }
    }

    return { imported: imported, total: rows.length, sounds: rows };
  }

  window.SoundsApiClient = {
    baseUrl: baseUrl,
    listSounds: listSounds,
    getSound: getSound,
    audioUrl: audioUrl,
    fetchAudioBlob: fetchAudioBlob,
    syncIntoApp: syncIntoApp
  };
})();
