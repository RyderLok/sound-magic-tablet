/**
 * P3 · New Sounds（Figma 1:49）
 *
 * 只展示「最近一次上传」的录音；历史录音在 My sounds。
 * 选择状态仍走 App.soundLibrary / PlateManager。
 */
(function () {
  'use strict';

  function el(id) { return document.getElementById(id); }

  function app() { return window.App || null; }

  function samples() {
    var a = app();
    var client = window.SoundsApiClient;
    if (a && client && typeof client.listLatestSamples === 'function') {
      return client.listLatestSamples(a);
    }
    return (a && Array.isArray(a.soundLibrary)) ? a.soundLibrary : [];
  }

  /** Plate slots used (after prune) — must match App.togglePlateSelection limit. */
  function selectedCount() {
    var a = app();
    if (!window.PlateManager) return 0;
    if (a && typeof window.PlateManager.liveCount === 'function') {
      return window.PlateManager.liveCount(a);
    }
    return samples().filter(function (s) { return isSelected(s.id); }).length;
  }

  function maxBrushes() {
    return window.PlateManager ? window.PlateManager.MAX_BRUSHES : 5;
  }

  function isSelected(id) {
    return window.PlateManager ? window.PlateManager.isSelected(id) : false;
  }

  /** Drop leftover My sounds / old-batch picks so New Sounds can use all 5 slots. */
  function syncPlateToNewSounds() {
    var a = app();
    if (!a || !window.PlateManager) return;
    if (typeof window.PlateManager.prune === 'function') window.PlateManager.prune(a);
    var latestIds = samples().map(function (s) { return s && s.id; }).filter(Boolean);
    // Never retainOnly([]) during a transient empty sync — that would wipe picks.
    if (latestIds.length && typeof window.PlateManager.retainOnly === 'function') {
      window.PlateManager.retainOnly(latestIds);
    }
  }

  /** Figma 用 mm:ss 两位补零（00:13） */
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

  function render() {
    var track = el('soundsTrack');
    if (!track) return;

    syncPlateToNewSounds();

    var list = samples();
    if (!list.length) {
      track.innerHTML = '<p class="sounds-empty">No new sounds yet — go to Input first</p>';
      updateFooter();
      return;
    }

    var used = selectedCount();
    var atLimit = used >= maxBrushes();

    track.innerHTML = list.map(function (s, idx) {
      var picked = isSelected(s.id);
      var blocked = !picked && atLimit;
      var name = 'sound' + (idx + 1);
      return '' +
        '<div class="sound-card' + (picked ? ' is-selected' : '') + (blocked ? ' is-disabled' : '') + '"' +
        ' data-sound-id="' + escapeHtml(s.id) + '" role="button" tabindex="0" aria-pressed="' + picked + '">' +
          '<span class="sound-check">✓</span>' +
          '<div class="sound-preview"><canvas id="pv-' + escapeHtml(s.id) + '" width="195" height="140"></canvas></div>' +
          '<p class="sound-name" title="' + escapeHtml(name) + '">' + escapeHtml(name) + '</p>' +
          '<div class="sound-wave-slot"><canvas id="pw-' + escapeHtml(s.id) + '" width="195" height="54"></canvas></div>' +
          '<button type="button" class="sound-play" data-play-id="' + escapeHtml(s.id) + '" title="播放">' +
            '<img class="icon-play" src="piko-assets/icon-play.svg" alt="播放" />' +
            '<img class="icon-pause hidden" src="piko-assets/icon-pause.svg" alt="暂停" />' +
          '</button>' +
          '<p class="sound-dur">' + escapeHtml(formatDuration(s.duration)) + '</p>' +
        '</div>';
    }).join('');

    drawCanvases(list);
    updateFooter();
    syncPlaybackUi();
  }

  /** 重绘卡片后恢复播放中按钮 / 波形进度 / 已播时长，避免被 innerHTML 冲掉 */
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

      var wave = el('pw-' + s.id);
      if (wave && a && typeof a.drawMiniWaveform === 'function' && s.waveformSnapshot && s.waveformSnapshot.length) {
        a.drawMiniWaveform(wave, s.waveformSnapshot, accent);
      }

      var preview = el('pv-' + s.id);
      if (preview) drawPreview(preview, s);
    });
  }

  /** Figma New Sounds color tile — always filled (never white empty). */
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

  function updateFooter() {
    var n = selectedCount();
    var max = maxBrushes();
    var countEl = el('soundsCount');
    if (countEl) {
      countEl.textContent = n + '/' + max + ' selected';
      countEl.classList.toggle('has-selection', n > 0);
    }
    var nextBtn = el('soundsNextBtn');
    if (nextBtn) nextBtn.disabled = n === 0;
  }

  function bind() {
    var track = el('soundsTrack');
    if (track) {
      track.addEventListener('click', function (event) {
        var playBtn = event.target.closest('[data-play-id]');
        if (playBtn) {
          event.stopPropagation();
          var a = app();
          if (a && typeof a.togglePlaySample === 'function') a.togglePlaySample(playBtn.dataset.playId);
          return;
        }
        var card = event.target.closest('[data-sound-id]');
        if (!card || card.classList.contains('is-disabled')) return;
        var a2 = app();
        if (a2 && typeof a2.togglePlateSelection === 'function') {
          a2.togglePlateSelection(card.dataset.soundId);
        }
        render();
      });
    }

    var recordBtn = el('soundsRecordBtn');
    if (recordBtn) {
      recordBtn.addEventListener('click', function () {
        if (window.PikoRouter) window.PikoRouter.show('collect');
      });
    }

    var nextBtn = el('soundsNextBtn');
    if (nextBtn) {
      nextBtn.addEventListener('click', function () {
        if (nextBtn.disabled) return;
        if (window.PikoRouter) window.PikoRouter.show('magic');
      });
    }

    // 进入本屏时：先拉后端 Sounds，再渲染
    document.addEventListener('piko:screen', function (event) {
      if (!event.detail || event.detail.screen !== 'sounds') return;
      var a = app();
      var client = window.SoundsApiClient;
      // 非 Transfer 会话（例如从 Draw 进来）：不得展示上一次上传残留
      if (client && typeof client.isTransferSessionActive === 'function' &&
          !client.isTransferSessionActive() &&
          typeof client.clearNewSoundsSession === 'function') {
        client.clearNewSoundsSession();
      }
      if (a && client && typeof client.syncIntoApp === 'function') {
        client.syncIntoApp(a).finally(function () { render(); });
      } else {
        render();
      }
    });
  }

  /**
   * 录音库是异步加载的，且旧界面通过 App.renderLibrary / renderPlatePanel 更新。
   * 包一层让本屏跟着刷新，避免复制一套数据订阅。
   */
  function hookAppUpdates() {
    var a = app();
    if (!a) return false;

    ['renderLibrary', 'renderPlatePanel'].forEach(function (name) {
      var original = a[name];
      if (typeof original !== 'function' || original.__pikoHooked) return;
      var wrapped = function () {
        var result = original.apply(this, arguments);
        render();
        return result;
      };
      wrapped.__pikoHooked = true;
      a[name] = wrapped;
    });
    return true;
  }

  function init() {
    bind();
    if (!hookAppUpdates()) {
      // App 尚未就绪时轮询等待，最多 5 秒
      var tries = 0;
      var timer = setInterval(function () {
        if (hookAppUpdates() || ++tries > 50) clearInterval(timer);
      }, 100);
    }
    render();
  }

  window.PikoSoundsScreen = { render: render };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
