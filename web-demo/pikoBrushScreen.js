/**
 * P5 · Sound Brush（Figma 1:352）
 *
 * 展示已选录音变成的笔刷列表；右侧预览板用真实 BrushGenerator
 * 做循环笔迹动画，实时展示该声音转化后的笔刷样式。
 */
(function () {
  'use strict';

  var activeId = null;
  var preview = {
    raf: null,
    canvas: null,
    art: null,
    persist: null,
    brush: null,
    sampleId: null,
    t0: 0,
    prevX: 0,
    prevY: 0,
    phase: 0,
    strokeAge: 0
  };

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

  // 显色板底色固定 #F9F8F4，不再用调色板渐变/染色（旧逻辑会铺出粉灰底）
  var PAPER_HEX = '#F9F8F4';

  function resolveBrushParams(sample) {
    var vp = (sample && sample.visualParams) || {};
    var mods = (sample && sample.styleModifiers) || {};
    var feats = (sample && sample.features) || {};
    if (window.BrushSchema && typeof window.BrushSchema.fromVisualAndModifiers === 'function') {
      return window.BrushSchema.fromVisualAndModifiers(vp, mods, feats);
    }
    return {
      motion: vp.motionSpeed || 0.2,
      continuity: vp.flowSmoothness || 0.5,
      particleDensity: vp.particleDensity || 0.25,
      turbulence: vp.directionChange || 0.15,
      strokePattern: vp.strokePattern || 'flow_field'
    };
  }

  function ensurePreviewLayers(w, h) {
    if (typeof createGraphics !== 'function') return false;
    if (preview.art && preview.art.width === w && preview.art.height === h) return true;
    if (preview.art && typeof preview.art.remove === 'function') preview.art.remove();
    if (preview.persist && typeof preview.persist.remove === 'function') preview.persist.remove();
    preview.art = createGraphics(w, h);
    preview.persist = createGraphics(w, h);
    preview.art.pixelDensity(1);
    preview.persist.pixelDensity(1);
    preview.art.clear();
    preview.persist.clear();
    return true;
  }

  function stopLivePreview() {
    if (preview.raf != null) {
      cancelAnimationFrame(preview.raf);
      preview.raf = null;
    }
    preview.sampleId = null;
    preview.brush = null;
    preview.strokeAge = 0;
  }

  function demoPoint(pattern, t, w, h, energy) {
    var cx = w * 0.5;
    var cy = h * 0.52;
    var R = Math.min(w, h) * (0.28 + energy * 0.06);
    if (pattern === 'scatter_points') {
      var hop = Math.floor(t * 2.4);
      var seed = hop * 12.9898;
      var rx = Math.sin(seed) * 0.5 + 0.5;
      var ry = Math.cos(seed * 1.7) * 0.5 + 0.5;
      return {
        x: cx + (rx - 0.5) * R * 1.7,
        y: cy + (ry - 0.5) * R * 1.2
      };
    }
    if (pattern === 'wave_ripple') {
      var wx = ((t * 0.22) % 1) * w * 0.72 + w * 0.14;
      return {
        x: wx,
        y: cy + Math.sin(t * 2.1) * R * 0.55 + Math.sin(t * 0.7) * R * 0.2
      };
    }
    if (pattern === 'impact_burst') {
      var burstT = (t % 1.6) / 1.6;
      var ang = burstT * Math.PI * 2 * 3;
      var rad = R * (0.12 + 0.88 * Math.min(1, burstT * 1.35));
      return { x: cx + Math.cos(ang) * rad, y: cy + Math.sin(ang) * rad * 0.9 };
    }
    if (pattern === 'pulse_grid') {
      var gx = Math.floor(((t * 0.9) % 1) * 5);
      var gy = Math.floor(((t * 0.55) % 1) * 3);
      return {
        x: w * 0.22 + gx * (w * 0.14),
        y: h * 0.28 + gy * (h * 0.18) + Math.sin(t * 3 + gx) * 6
      };
    }
    // flow_field：螺旋 + 慢漂
    var ang2 = t * 1.55;
    var rad2 = R * (0.22 + 0.78 * (0.5 + 0.5 * Math.sin(t * 0.35)));
    return {
      x: cx + Math.cos(ang2) * rad2 + Math.sin(t * 0.41) * R * 0.18,
      y: cy + Math.sin(ang2) * rad2 * 0.88 + Math.cos(t * 0.33) * R * 0.12
    };
  }

  function paintFallback(ctx, sample, now) {
    var w = ctx.canvas.width;
    var h = ctx.canvas.height;
    var palette = (sample.visualParams && sample.visualParams.palette) || [];
    ctx.fillStyle = PAPER_HEX;
    ctx.fillRect(0, 0, w, h);

    if (!palette.length) return;
    var t = (now - preview.t0) / 1000;
    var pattern = (sample.visualParams && sample.visualParams.strokePattern) || 'flow_field';
    var c0 = palette[0];
    var c1 = palette[1] || c0;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (var i = 0; i < 36; i++) {
      var u = t * 0.9 - i * 0.045;
      if (u < 0) continue;
      var a = demoPoint(pattern, u, w, h, 0.4);
      var b = demoPoint(pattern, u + 0.03, w, h, 0.4);
      var fade = 1 - i / 36;
      var mix = i % 2 ? c1 : c0;
      ctx.strokeStyle = 'rgba(' + mix.r + ',' + mix.g + ',' + mix.b + ',' + (0.18 + fade * 0.55) + ')';
      ctx.lineWidth = 1.2 + fade * 2.4;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  }

  function startLivePreview(sample) {
    var panel = el('brushPreview');
    if (!panel || !sample) {
      stopLivePreview();
      return;
    }

    var canvas = panel.querySelector('canvas');
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.width = 596;
      canvas.height = 336;
      panel.innerHTML = '';
      panel.appendChild(canvas);
    }
    preview.canvas = canvas;

    if (preview.sampleId === sample.id && preview.raf != null) return;

    stopLivePreview();
    preview.sampleId = sample.id;
    preview.t0 = performance.now();
    preview.phase = 0;
    preview.strokeAge = 0;

    var w = canvas.width;
    var h = canvas.height;
    var useP5 = typeof BrushGenerator === 'function' && ensurePreviewLayers(w, h);
    if (useP5) {
      preview.brush = new BrushGenerator();
      preview.brush.persistStrokes = true;
      preview.brush.POINT_ALPHA = 34;
      preview.art.clear();
      preview.persist.clear();
      var start = demoPoint(
        (sample.visualParams && sample.visualParams.strokePattern) || 'flow_field',
        0,
        w,
        h,
        0.35
      );
      preview.prevX = start.x;
      preview.prevY = start.y;
    }

    function frame(now) {
      if (preview.sampleId !== sample.id) return;
      var ctx = canvas.getContext('2d');
      var vp = sample.visualParams || {};
      var pattern = vp.strokePattern || 'flow_field';
      var energy = (sample.features && sample.features.energy) || 0.35;

      if (useP5 && preview.brush && preview.art) {
        var bp = resolveBrushParams(sample);
        var prevBrush = window.activeBrushParams;
        var prevAf = window.activeAcousticFeatures;
        window.activeBrushParams = bp;
        if (sample.features) window.activeAcousticFeatures = sample.features;

        // 预览节奏：约 8s 转一圈，约 10s 轻清一次（原先约 4s / 4.8s 偏快）
        preview.phase += 0.016 * (0.42 + energy * 0.28);
        var pt = demoPoint(pattern, preview.phase, w, h, energy);
        preview.brush.addStroke(pt.x, pt.y, preview.prevX, preview.prevY, vp);
        preview.prevX = pt.x;
        preview.prevY = pt.y;
        preview.strokeAge += 0.016;

        // 周期性轻清一次，避免粒子堆满变糊
        if (preview.strokeAge > 10) {
          preview.persist.clear();
          preview.art.clear();
          preview.brush.clear();
          preview.strokeAge = 0;
        }

        preview.brush.updateAndDraw(preview.art, vp, sample.aiResult || {}, sample.aiResult || null, null);

        ctx.fillStyle = PAPER_HEX;
        ctx.fillRect(0, 0, w, h);
        if (preview.persist.elt) ctx.drawImage(preview.persist.elt, 0, 0);
        if (preview.art.elt) ctx.drawImage(preview.art.elt, 0, 0);

        window.activeBrushParams = prevBrush;
        window.activeAcousticFeatures = prevAf;
      } else {
        paintFallback(ctx, sample, now);
      }

      preview.raf = requestAnimationFrame(frame);
    }
    preview.raf = requestAnimationFrame(frame);
  }

  function drawPreview(sample) {
    var panel = el('brushPreview');
    if (!panel) return;
    if (!sample) {
      stopLivePreview();
      var canvas = panel.querySelector('canvas');
      if (!canvas) {
        canvas = document.createElement('canvas');
        canvas.width = 596;
        canvas.height = 336;
        panel.innerHTML = '';
        panel.appendChild(canvas);
      }
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = PAPER_HEX;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      return;
    }
    startLivePreview(sample);
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
            '<img class="icon-play" src="piko-assets/icon-play.svg" alt="播放" />' +
            '<img class="icon-pause hidden" src="piko-assets/icon-pause.svg" alt="暂停" />' +
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

    var a = app();
    if (a && a.playbackSampleId && typeof a.setPlayButtonState === 'function') {
      var playing = !!(a.playbackAudio && !a.playbackAudio.paused);
      a.setPlayButtonState(a.playbackSampleId, playing);
      if (a.playbackAudio && typeof a._updatePlaybackTimeLabels === 'function') {
        // 正在播 / 暂停中：显示已播时间；否则总时长已由上面 HTML 写好
        if (playing || a.playbackAudio.paused) {
          a._updatePlaybackTimeLabels(a.playbackSampleId, a.playbackAudio.currentTime || 0);
        }
      }
      if (playing && typeof a._paintPlaybackWaveforms === 'function' && a.playbackAudio) {
        var dur = a.playbackAudio.duration || 0;
        a._paintPlaybackWaveforms(a.playbackSampleId, dur > 0 ? a.playbackAudio.currentTime / dur : 0);
      }
    }
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
        stopLivePreview();
        if (window.PikoRouter) window.PikoRouter.show('sounds');
      });
    }

    var useBtn = el('brushUseBtn');
    if (useBtn) {
      useBtn.addEventListener('click', function () {
        var a = app();
        if (!brushes().length) return;
        if (activeId && window.PlateManager) window.PlateManager.setActiveBrush(activeId);
        stopLivePreview();
        // 先切路由藏起新屏，再进入既有色盘画板
        if (window.PikoRouter) window.PikoRouter.show('analysis');
        if (a && typeof a.enterPlateStudio === 'function') a.enterPlateStudio();
        if (window.PikoCanvasScreen) window.PikoCanvasScreen.activate();
      });
    }

    document.addEventListener('piko:screen', function (event) {
      if (!event.detail) return;
      if (event.detail.screen === 'brush') {
        render();
      } else {
        stopLivePreview();
      }
    });
  }

  window.PikoBrushScreen = { render: render, stopPreview: stopLivePreview };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
