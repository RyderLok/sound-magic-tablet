/**
 * P2c · My sounds — 历史录音浏览 + 多选删除（Figma 132:25）
 *
 * 平时只浏览/播放；右上角 checklist 进入多选，可 Delete。
 * 只展示「非最新上传批次」的历史录音；最新批次在 New Sounds。
 */
(function () {
  'use strict';

  var selectMode = false;
  var selectedIds = {};

  function el(id) { return document.getElementById(id); }

  function app() { return window.App || null; }

  function samples() {
    var a = app();
    var client = window.SoundsApiClient;
    if (a && client && typeof client.listHistorySamples === 'function') {
      return client.listHistorySamples(a);
    }
    return (a && Array.isArray(a.soundLibrary)) ? a.soundLibrary : [];
  }

  function selectedCount() {
    return Object.keys(selectedIds).length;
  }

  function formatDuration(d) {
    var total = Math.max(0, Math.round(Number(d) || 0));
    var m = String(Math.floor(total / 60)).padStart(2, '0');
    var s = String(total % 60).padStart(2, '0');
    return m + ':' + s;
  }

  function escapeHtml(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function backendIdFor(sample) {
    if (!sample) return null;
    return sample.backendId || null;
  }

  function syncSelectChrome() {
    var view = el('mySoundsView');
    var btn = el('mySoundsMenuBtn');
    var bar = el('mySoundsSelectBar');
    var countEl = el('mySoundsSelectCount');
    if (view) view.classList.toggle('is-selecting', selectMode);
    if (btn) {
      btn.classList.toggle('is-active', selectMode);
      btn.setAttribute('aria-pressed', selectMode ? 'true' : 'false');
      btn.title = selectMode ? '完成多选' : '多选';
      btn.setAttribute('aria-label', selectMode ? '完成多选' : '多选');
    }
    if (bar) bar.classList.toggle('hidden', !selectMode);
    if (countEl) countEl.textContent = selectedCount() + ' selected';
    var del = el('mySoundsDeleteBtn');
    if (del) del.disabled = selectedCount() < 1;
  }

  function setSelectMode(on) {
    selectMode = !!on;
    if (!selectMode) selectedIds = {};
    syncSelectChrome();
    var track = el('mySoundsTrack');
    if (!track) return;
    track.querySelectorAll('.sound-card').forEach(function (card) {
      var id = card.dataset.soundId;
      card.classList.toggle('is-selected', !!(id && selectedIds[id]));
      var check = card.querySelector('.sound-check');
      if (check) check.hidden = !selectMode;
    });
  }

  function toggleCard(id, card) {
    if (!id) return;
    if (selectedIds[id]) delete selectedIds[id];
    else selectedIds[id] = true;
    if (card) card.classList.toggle('is-selected', !!selectedIds[id]);
    syncSelectChrome();
  }

  async function deleteSelected() {
    var ids = Object.keys(selectedIds);
    if (!ids.length) return;

    var a = app();
    var client = window.SoundsApiClient;
    var list = samples();
    var byId = {};
    list.forEach(function (s) { byId[s.id] = s; });

    for (var i = 0; i < ids.length; i++) {
      var sampleId = ids[i];
      var sample = byId[sampleId];
      var remoteId = backendIdFor(sample) || sampleId;
      if (client && typeof client.deleteSound === 'function') {
        try {
          await client.deleteSound(remoteId);
        } catch (err) {
          console.warn('[MySounds] backend delete failed:', remoteId, err);
        }
      }
      if (a && typeof a.deleteSample === 'function') {
        a.deleteSample(sampleId);
      } else if (window.SampleLibraryStore) {
        await window.SampleLibraryStore.deleteSample(sampleId);
      }
      if (client && typeof client.forgetFromLatestBatch === 'function') {
        client.forgetFromLatestBatch(sampleId, remoteId);
      }
    }

    selectedIds = {};
    render();
    syncSelectChrome();
  }

  function render() {
    var track = el('mySoundsTrack');
    if (!track) return;

    var list = samples();
    if (!list.length) {
      setSelectMode(false);
      track.innerHTML = '<p class="sounds-empty">还没有历史录音</p>';
      syncSelectChrome();
      return;
    }

    track.innerHTML = list.map(function (s, idx) {
      var picked = !!selectedIds[s.id];
      var name = 'Sound ' + String(idx + 1).padStart(2, '0');
      return '' +
        '<div class="sound-card' + (picked ? ' is-selected' : '') + '"' +
        ' data-sound-id="' + escapeHtml(s.id) + '" role="button" tabindex="0"' +
        ' aria-pressed="' + (selectMode && picked) + '">' +
          '<span class="sound-check"' + (selectMode ? '' : ' hidden') + '>✓</span>' +
          '<div class="sound-preview"><canvas id="ms-pv-' + escapeHtml(s.id) + '" width="195" height="140"></canvas></div>' +
          '<p class="sound-name" title="' + escapeHtml(name) + '">' + escapeHtml(name) + '</p>' +
          '<div class="sound-wave-slot"><canvas id="ms-pw-' + escapeHtml(s.id) + '" width="195" height="54"></canvas></div>' +
          '<button type="button" class="sound-play" data-play-id="' + escapeHtml(s.id) + '" title="播放">' +
            '<img class="icon-play" src="piko-assets/icon-play.svg" alt="播放" />' +
            '<img class="icon-pause hidden" src="piko-assets/icon-pause.svg" alt="暂停" />' +
          '</button>' +
          '<p class="sound-dur">' + escapeHtml(formatDuration(s.duration)) + '</p>' +
        '</div>';
    }).join('');

    drawCanvases(list);
    syncPlaybackUi();
    syncSelectChrome();
  }

  function syncPlaybackUi() {
    var a = app();
    if (!a || !a.playbackSampleId) return;
    var playing = !!(a.playbackAudio && !a.playbackAudio.paused);
    if (typeof a.setPlayButtonState === 'function') {
      a.setPlayButtonState(a.playbackSampleId, playing);
    }
    if (a.playbackAudio && typeof a._updatePlaybackTimeLabels === 'function') {
      if (playing || a.playbackAudio.paused) {
        a._updatePlaybackTimeLabels(a.playbackSampleId, a.playbackAudio.currentTime || 0);
      }
    }
    if (playing && typeof a._paintPlaybackWaveforms === 'function' && a.playbackAudio) {
      var dur = a.playbackAudio.duration || 0;
      var p = dur > 0 ? a.playbackAudio.currentTime / dur : 0;
      a._paintPlaybackWaveforms(a.playbackSampleId, p);
    }
  }

  function drawCanvases(list) {
    var a = app();
    list.forEach(function (s) {
      var accent = s.visualParams && s.visualParams.palette && s.visualParams.palette[0];

      var wave = el('ms-pw-' + s.id);
      if (wave && a && typeof a.drawMiniWaveform === 'function' && s.waveformSnapshot && s.waveformSnapshot.length) {
        a.drawMiniWaveform(wave, s.waveformSnapshot, accent);
      }

      var preview = el('ms-pv-' + s.id);
      if (preview) drawPreview(preview, s);
    });
  }

  /** Same Figma card fill as New Sounds — never leave blank white. */
  function drawPreview(canvas, sample) {
    if (window.SoundColorEngine && typeof window.SoundColorEngine.drawCardPreview === 'function') {
      window.SoundColorEngine.drawCardPreview(canvas, sample);
      return;
    }
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#FE2E3E';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  function bind() {
    var back = el('mySoundsBackBtn');
    if (back && !back.dataset.bound) {
      back.dataset.bound = '1';
      back.addEventListener('click', function () {
        if (window.PikoRouter) window.PikoRouter.show('collect');
      });
    }

    var menu = el('mySoundsMenuBtn');
    if (menu && !menu.dataset.bound) {
      menu.dataset.bound = '1';
      menu.addEventListener('click', function () {
        setSelectMode(!selectMode);
      });
    }

    var del = el('mySoundsDeleteBtn');
    if (del && !del.dataset.bound) {
      del.dataset.bound = '1';
      del.addEventListener('click', function () {
        if (!selectedCount()) return;
        deleteSelected();
      });
    }

    var track = el('mySoundsTrack');
    if (track && !track.dataset.bound) {
      track.dataset.bound = '1';
      track.addEventListener('click', function (event) {
        var playBtn = event.target.closest('[data-play-id]');
        if (playBtn) {
          event.stopPropagation();
          var a = app();
          if (a && typeof a.togglePlaySample === 'function') a.togglePlaySample(playBtn.dataset.playId);
          return;
        }
        var card = event.target.closest('[data-sound-id]');
        if (!card) return;
        if (!selectMode) return;
        toggleCard(card.dataset.soundId, card);
      });
    }

    document.addEventListener('piko:screen', function (event) {
      if (!event.detail) return;
      if (event.detail.screen === 'mySounds') {
        var a = app();
        var client = window.SoundsApiClient;
        if (a && client && typeof client.syncIntoApp === 'function') {
          client.syncIntoApp(a).finally(function () { render(); });
        } else {
          render();
        }
      } else {
        setSelectMode(false);
      }
    });
  }

  function hookAppUpdates() {
    var a = app();
    if (!a) return false;

    ['renderLibrary', 'renderPlatePanel'].forEach(function (name) {
      var original = a[name];
      if (typeof original !== 'function' || original.__pikoMySoundsHooked) return;
      var wrapped = function () {
        var result = original.apply(this, arguments);
        if (window.PikoRouter && window.PikoRouter.current === 'mySounds') render();
        return result;
      };
      wrapped.__pikoMySoundsHooked = true;
      // Preserve earlier hooks (e.g. New Sounds) if already wrapped
      if (original.__pikoHooked) wrapped.__pikoHooked = true;
      a[name] = wrapped;
    });
    return true;
  }

  function init() {
    bind();
    if (!hookAppUpdates()) {
      var tries = 0;
      var timer = setInterval(function () {
        if (hookAppUpdates() || ++tries > 50) clearInterval(timer);
      }, 100);
    }
  }

  window.PikoMySoundsScreen = { render: render, setSelectMode: setSelectMode };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
