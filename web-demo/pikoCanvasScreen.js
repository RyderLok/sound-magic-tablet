/**
 * P6 · Canvas chrome（Figma 1:298）
 *
 * 不重写 p5 画布：在既有 analysisView / #canvasHolder 上套一层 Figma 顶栏，
 * 色盘槽位绑定 PlateManager，橡皮/返回接既有工具。
 */
(function () {
  'use strict';

  function el(id) { return document.getElementById(id); }
  function app() { return window.App || null; }

  function brushes() {
    var a = app();
    if (!a || !window.PlateManager) return [];
    return window.PlateManager.getSelectedSamples(a) || [];
  }

  function slotColor(sample) {
    var pal = sample && sample.visualParams && sample.visualParams.palette;
    if (pal && pal[0]) return 'rgb(' + pal[0].r + ',' + pal[0].g + ',' + pal[0].b + ')';
    return 'var(--piko-orange)';
  }

  function renderPalette() {
    var pill = el('pikoPalettePill');
    if (!pill) return;

    var list = brushes();
    var activeId = window.PlateManager ? window.PlateManager.activeBrushId : null;
    var max = window.PlateManager ? window.PlateManager.MAX_BRUSHES : 5;
    var html = '';

    for (var i = 0; i < max; i++) {
      var s = list[i];
      if (s) {
        html += '<button type="button" class="piko-palette-slot' +
          (s.id === activeId ? ' is-active' : '') +
          '" data-brush-id="' + s.id + '" style="background:' + slotColor(s) +
          '" title="' + (s.name || 'Brush') + '" role="option" aria-selected="' +
          (s.id === activeId) + '"></button>';
      } else {
        html += '<span class="piko-palette-slot is-empty" aria-hidden="true"></span>';
      }
    }
    html += '<span class="piko-palette-more" aria-hidden="true">⋯</span>';
    pill.innerHTML = html;
  }

  function setChromeVisible(on) {
    var view = el('analysisView');
    var chrome = el('pikoCanvasChrome');
    if (view) view.classList.toggle('piko-canvas-mode', !!on);
    if (chrome) chrome.classList.toggle('hidden', !on);
  }

  function activate() {
    setChromeVisible(true);
    renderPalette();
    syncEraseState();
    // 全幅化后让 p5 按新尺寸重算
    requestAnimationFrame(function () {
      if (typeof windowResized === 'function') windowResized();
    });
  }

  function deactivate() {
    setChromeVisible(false);
  }

  function syncEraseState() {
    var btn = el('pikoCanvasEraseBtn');
    var a = app();
    var eraseOn = !!(a && a.canvasInteraction && a.canvasInteraction.canvasTool === 'erase');
    // 回退：看旧按钮状态
    if (!eraseOn) {
      var old = el('canvasToolEraseBtn');
      eraseOn = !!(old && old.classList.contains('is-active'));
    }
    if (btn) btn.classList.toggle('is-active', eraseOn);
  }

  function bind() {
    var back = el('pikoCanvasBackBtn');
    if (back) {
      back.addEventListener('click', function () {
        deactivate();
        if (window.PikoRouter) window.PikoRouter.show('brush');
      });
    }

    var erase = el('pikoCanvasEraseBtn');
    if (erase) {
      erase.addEventListener('click', function () {
        var a = app();
        var next = erase.classList.contains('is-active') ? 'draw' : 'erase';
        if (a && typeof a.setCanvasTool === 'function') a.setCanvasTool(next);
        syncEraseState();
      });
    }

    var save = el('pikoCanvasSaveBtn');
    if (save) {
      save.addEventListener('click', function () {
        deactivate();
        // 保存逻辑占位：先进入图库空态
        if (window.PikoRouter) window.PikoRouter.show('gallery');
      });
    }

    var pill = el('pikoPalettePill');
    if (pill) {
      pill.addEventListener('click', function (event) {
        var slot = event.target.closest('[data-brush-id]');
        if (!slot) return;
        var id = slot.dataset.brushId;
        var a = app();
        if (window.PlateManager) window.PlateManager.setActiveBrush(id);
        if (a && typeof a.applyActiveBrushGlobals === 'function') {
          a.applyActiveBrushGlobals(false);
        }
        if (a && typeof a.renderBrushStrip === 'function') a.renderBrushStrip();
        renderPalette();
      });
    }

    // Use Brush → analysis 时激活顶栏
    document.addEventListener('piko:screen', function (event) {
      if (!event.detail) return;
      if (event.detail.screen === 'analysis') {
        var a = app();
        if (a && a.plateMode) activate();
        else deactivate();
      } else {
        deactivate();
      }
    });
  }

  window.PikoCanvasScreen = {
    activate: activate,
    deactivate: deactivate,
    renderPalette: renderPalette
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
