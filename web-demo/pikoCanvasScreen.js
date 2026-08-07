/**
 * P6 · Canvas chrome（Figma 1:298）
 *
 * 不重写 p5 画布：在既有 analysisView / #canvasHolder 上套一层 Figma 顶栏，
 * 色盘槽位绑定 PlateManager，橡皮/返回接既有工具。
 * 布局：深褐底 #413A35 + 圆角白画板 (87,157) 880×623 + 橙底色盘 pill。
 * 白纸可 Procreate 式双指拖移/捏合、滚轮缩放；棕底只作桌面、不落笔。
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
    // 布局已常驻为 Figma 画板；class 仅供 canvasInteraction 等判断
    if (view) view.classList.toggle('piko-canvas-mode', !!on);
    if (chrome) chrome.classList.toggle('hidden', !on);
  }

  function activate() {
    setChromeVisible(true);
    // sphere host 创建时可能给 holder 写了 inline position:relative，会盖掉 Figma 绝对定位
    var holder = el('canvasHolder');
    if (holder) {
      holder.style.position = '';
      // 清掉上次会话的偏移，先回到 CSS 默认 Figma 位
      holder.style.left = '';
      holder.style.top = '';
      holder.style.width = '';
      holder.style.height = '';
      holder.style.transform = '';
      holder.style.transformOrigin = '';
    }
    renderPalette();
    syncEraseState();
    var a = app();
    function snapPaperToFigma() {
      if (a && a.canvasInteraction && typeof a.canvasInteraction.resetPaperTransform === 'function') {
        a.canvasInteraction.resetPaperTransform();
      }
    }
    snapPaperToFigma();
    // 圆角画板尺寸变化后让 p5 按新尺寸重算，再钉一次默认位
    requestAnimationFrame(function () {
      if (typeof windowResized === 'function') windowResized();
      requestAnimationFrame(snapPaperToFigma);
    });
  }

  function deactivate() {
    var view = el('analysisView');
    var a = app();
    // 路由已离开 analysis 时：先藏画板再卸 chrome，避免露出旧顶栏/侧栏闪一下
    if (view && window.PikoRouter && window.PikoRouter.current !== 'analysis') {
      view.classList.add('hidden');
      view.classList.remove(
        'piko-entering', 'piko-leaving',
        'piko-enter-fwd', 'piko-leave-fwd',
        'piko-enter-back', 'piko-leave-back',
        'piko-enter-fade', 'piko-leave-fade'
      );
    }
    if (a && a.canvasInteraction && typeof a.canvasInteraction.clearPaperTransformStyle === 'function') {
      a.canvasInteraction.clearPaperTransformStyle();
    }
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
        // 画板返回 → Collect 首页（P3）
        deactivate();
        if (window.PikoRouter) window.PikoRouter.show('collect', { mode: 'back' });
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
      save.addEventListener('click', async function () {
        var a = app();
        var ci = a && a.canvasInteraction;
        if (!ci || typeof ci.exportArtworkPng !== 'function') {
          console.warn('[PikoCanvas] save: no canvasInteraction.exportArtworkPng');
          return;
        }
        if (!window.GalleryStore) {
          console.warn('[PikoCanvas] save: GalleryStore missing');
          return;
        }

        save.disabled = true;
        try {
          var blob = await ci.exportArtworkPng();
          if (!blob) {
            console.warn('[PikoCanvas] save: empty artwork blob');
            return;
          }
          var resumeId = a && a.editingArtworkId;
          var id = resumeId ||
            ('art_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7));
          var brushSnapshot = (a && typeof a.captureBrushSnapshot === 'function')
            ? a.captureBrushSnapshot()
            : null;
          var saved = await window.GalleryStore.save({
            id: id,
            title: 'Artwork',
            width: (ci.paper && ci.paper.w) || 880,
            height: (ci.paper && ci.paper.h) || 623,
            createdAt: resumeId ? undefined : Date.now(),
            updatedAt: Date.now(),
            imageBlob: blob,
            brushSnapshot: brushSnapshot
          });
          if (!saved) {
            console.warn('[PikoCanvas] save: GalleryStore.save failed');
            return;
          }
          if (a && brushSnapshot && typeof a.saveBrushSnapshotCache === 'function') {
            a.saveBrushSnapshotCache(id, brushSnapshot);
          }
          if (a) a.editingArtworkId = null;
          if (window.PikoRouter) window.PikoRouter.show('gallery', { mode: 'none' });
          else deactivate();
          // gallery 切屏会经 piko:screen 触发 PikoGalleryScreen.render()，这里不要再调一次（会竞态叠两套卡）
        } catch (err) {
          console.warn('[PikoCanvas] save failed:', err);
        } finally {
          save.disabled = false;
        }
      });
    }

    var pill = el('pikoPalettePill');
    if (pill) {
      var lastSwitchAt = 0;
      var switchBrush = function (event) {
        var slot = event.target.closest('[data-brush-id]');
        if (!slot) return;
        // Don't preventDefault — that cancels the click synthesis some WebViews need.
        event.stopPropagation();
        var now = Date.now();
        if (now - lastSwitchAt < 320) return;
        lastSwitchAt = now;
        var id = slot.dataset.brushId;
        var a = app();
        if (window.PlateManager) window.PlateManager.setActiveBrush(id);
        if (a && typeof a.applyActiveBrushGlobals === 'function') {
          a.applyActiveBrushGlobals(false);
        }
        if (a && typeof a.renderBrushStrip === 'function') a.renderBrushStrip();
        renderPalette();
      };
      pill.addEventListener('pointerup', switchBrush);
      pill.addEventListener('click', switchBrush);
    }

    // analysis 一律走 Figma 画板顶栏，不再回退旧后端 UI
    document.addEventListener('piko:screen', function (event) {
      if (!event.detail) return;
      if (event.detail.screen === 'analysis') activate();
      else deactivate();
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
