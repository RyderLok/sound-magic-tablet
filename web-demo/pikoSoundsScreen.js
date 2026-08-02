/**
 * P3 · My sounds（Figma 1:49）
 *
 * 只负责这一屏的渲染与交互，数据与选择状态仍走既有的
 * App.soundLibrary / PlateManager，不复制业务逻辑。
 */
(function () {
  'use strict';

  function el(id) { return document.getElementById(id); }

  function app() { return window.App || null; }

  function samples() {
    var a = app();
    return (a && Array.isArray(a.soundLibrary)) ? a.soundLibrary : [];
  }

  /** 只统计仍存在于录音库中的选择，避免历史残留 id 影响计数 */
  function selectedCount() {
    if (!window.PlateManager) return 0;
    return samples().filter(function (s) { return isSelected(s.id); }).length;
  }

  function maxBrushes() {
    return window.PlateManager ? window.PlateManager.MAX_BRUSHES : 5;
  }

  function isSelected(id) {
    return window.PlateManager ? window.PlateManager.isSelected(id) : false;
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

    var list = samples();
    if (!list.length) {
      track.innerHTML = '<p class="sounds-empty">还没有录音 — 先去录一段</p>';
      updateFooter();
      return;
    }

    var atLimit = selectedCount() >= maxBrushes();

    track.innerHTML = list.map(function (s) {
      var picked = isSelected(s.id);
      var blocked = !picked && atLimit;
      var name = (s.aiResult && s.aiResult.identity && s.aiResult.identity.name) || s.name;
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
      if (preview) drawPreview(preview, s, accent);
    });
  }

  /** 预览区：已分析的用调色板渐变，未分析留白 */
  function drawPreview(canvas, sample, accent) {
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    var palette = (sample.visualParams && sample.visualParams.palette) || [];
    if (!palette.length) return;

    var grad = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    palette.slice(0, 3).forEach(function (c, i, arr) {
      var stop = arr.length === 1 ? 0 : i / (arr.length - 1);
      grad.addColorStop(stop, 'rgb(' + c.r + ',' + c.g + ',' + c.b + ')');
    });
    ctx.fillStyle = grad;
    ctx.globalAlpha = 0.85;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = 1;

    if (accent) {
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.beginPath();
      ctx.arc(canvas.width * 0.5, canvas.height * 0.5, canvas.height * 0.3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function updateFooter() {
    var n = selectedCount();
    var countEl = el('soundsCount');
    if (countEl) {
      countEl.textContent = n + ' selected';
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

    // 进入本屏时刷新一次
    document.addEventListener('piko:screen', function (event) {
      if (event.detail && event.detail.screen === 'sounds') render();
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
