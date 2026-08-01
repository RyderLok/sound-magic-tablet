/**
 * P5 · Sound Brush（Figma 1:352）
 *
 * 展示已选录音变成的笔刷列表；数据仍走 PlateManager / App.soundLibrary。
 */
(function () {
  'use strict';

  var activeId = null;

  function el(id) { return document.getElementById(id); }
  function app() { return window.App || null; }

  function escapeHtml(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function formatDuration(d) {
    var total = Math.max(0, Math.round(Number(d) || 0));
    var m = String(Math.floor(total / 60)).padStart(2, '0');
    var s = String(total % 60).padStart(2, '0');
    return m + ':' + s;
  }

  function sampleName(s) {
    return (s.aiResult && s.aiResult.identity && s.aiResult.identity.name) || s.name || 'Untitled';
  }

  function brushes() {
    var a = app();
    if (!a || !window.PlateManager) return [];
    return window.PlateManager.getSelectedSamples(a) || [];
  }

  function ensureActive(list) {
    if (!list.length) {
      activeId = null;
      return null;
    }
    if (activeId && list.some(function (s) { return s.id === activeId; })) {
      return list.find(function (s) { return s.id === activeId; });
    }
    if (window.PlateManager && window.PlateManager.activeBrushId) {
      var fromPlate = list.find(function (s) { return s.id === window.PlateManager.activeBrushId; });
      if (fromPlate) {
        activeId = fromPlate.id;
        return fromPlate;
      }
    }
    activeId = list[0].id;
    if (window.PlateManager) window.PlateManager.setActiveBrush(activeId);
    return list[0];
  }

  function drawWave(canvas, sample) {
    if (!canvas || !sample) return;
    var a = app();
    var accent = sample.visualParams && sample.visualParams.palette && sample.visualParams.palette[0];
    if (a && typeof a.drawMiniWaveform === 'function' && sample.waveformSnapshot && sample.waveformSnapshot.length) {
      a.drawMiniWaveform(canvas, sample.waveformSnapshot, accent || { r: 241, g: 110, b: 28 });
      return;
    }
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  function drawPreview(sample) {
    var panel = el('brushPreview');
    if (!panel) return;
    var canvas = panel.querySelector('canvas');
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.width = 596;
      canvas.height = 336;
      panel.innerHTML = '';
      panel.appendChild(canvas);
    }
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!sample) return;
    var palette = (sample.visualParams && sample.visualParams.palette) || [];
    if (!palette.length) return;

    var grad = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    palette.slice(0, 3).forEach(function (c, i, arr) {
      var stop = arr.length === 1 ? 0 : i / (arr.length - 1);
      grad.addColorStop(stop, 'rgb(' + c.r + ',' + c.g + ',' + c.b + ')');
    });
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = 1;

    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.beginPath();
    ctx.arc(canvas.width * 0.5, canvas.height * 0.5, 72, 0, Math.PI * 2);
    ctx.fill();
  }

  function updateInfo(sample) {
    var nameEl = el('brushInfoName');
    var durEl = el('brushInfoDur');
    var wave = el('brushInfoWave');
    if (nameEl) nameEl.textContent = sample ? sampleName(sample) : '—';
    if (durEl) durEl.textContent = sample ? formatDuration(sample.duration) : '00:00';
    if (wave) drawWave(wave, sample);
    drawPreview(sample);
  }

  function updatePaletteCount() {
    var n = window.PlateManager ? window.PlateManager.count() : 0;
    var max = window.PlateManager ? window.PlateManager.MAX_BRUSHES : 5;
    var node = el('brushPaletteCount');
    if (node) node.textContent = 'Add to palette: ' + n + '/' + max;
  }

  function render() {
    var listEl = el('brushList');
    if (!listEl) return;

    var list = brushes();
    var active = ensureActive(list);
    updatePaletteCount();

    if (!list.length) {
      listEl.innerHTML = '<p class="brush-list-empty">还没有笔刷 — 先回 My sounds 勾选</p>';
      updateInfo(null);
      return;
    }

    listEl.innerHTML = list.map(function (s) {
      var selected = s.id === activeId;
      return '' +
        '<div class="brush-row' + (selected ? ' is-active' : '') + '" data-brush-id="' + escapeHtml(s.id) + '" role="button" tabindex="0" aria-pressed="' + selected + '">' +
          '<button type="button" class="brush-row-play" data-play-id="' + escapeHtml(s.id) + '" title="播放">' +
            '<img src="piko-assets/icon-play.svg" alt="播放" />' +
          '</button>' +
          '<p class="brush-row-name" title="' + escapeHtml(sampleName(s)) + '">' + escapeHtml(sampleName(s)) + '</p>' +
          '<p class="brush-row-dur">' + escapeHtml(formatDuration(s.duration)) + '</p>' +
          '<div class="brush-row-wave"><canvas id="bw-' + escapeHtml(s.id) + '" width="137" height="30"></canvas></div>' +
        '</div>';
    }).join('');

    list.forEach(function (s) {
      drawWave(el('bw-' + s.id), s);
    });
    updateInfo(active);
  }

  function selectBrush(id) {
    activeId = id;
    if (window.PlateManager) window.PlateManager.setActiveBrush(id);
    render();
  }

  function bind() {
    var listEl = el('brushList');
    if (listEl) {
      listEl.addEventListener('click', function (event) {
        var playBtn = event.target.closest('[data-play-id]');
        if (playBtn) {
          event.stopPropagation();
          var a = app();
          if (a && typeof a.togglePlaySample === 'function') a.togglePlaySample(playBtn.dataset.playId);
          return;
        }
        var row = event.target.closest('[data-brush-id]');
        if (row) selectBrush(row.dataset.brushId);
      });
    }

    var back = el('brushBackBtn');
    if (back) {
      back.addEventListener('click', function () {
        if (window.PikoRouter) window.PikoRouter.show('sounds');
      });
    }

    var useBtn = el('brushUseBtn');
    if (useBtn) {
      useBtn.addEventListener('click', function () {
        var a = app();
        if (!brushes().length) return;
        if (activeId && window.PlateManager) window.PlateManager.setActiveBrush(activeId);
        // 先切路由藏起新屏，再进入既有色盘画板
        if (window.PikoRouter) window.PikoRouter.show('analysis');
        if (a && typeof a.enterPlateStudio === 'function') a.enterPlateStudio();
        if (window.PikoCanvasScreen) window.PikoCanvasScreen.activate();
      });
    }

    document.addEventListener('piko:screen', function (event) {
      if (event.detail && event.detail.screen === 'brush') render();
    });
  }

  window.PikoBrushScreen = { render: render };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
