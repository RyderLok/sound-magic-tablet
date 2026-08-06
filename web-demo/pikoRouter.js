/**
 * Piko 屏幕路由（Figma 流程 P1 → P9）
 *
 * 过渡策略：新屏按 Figma 逐个替换，未替换的沿用旧 view，
 * 交互逻辑仍由 app.js 等既有模块负责，这里只管显示哪一屏。
 */
(function () {
  'use strict';

  var SPLASH_MS = 1500;

  var screens = {
    splash: 'splashView',
    collect: 'collectView',
    mySounds: 'mySoundsView',
    transfer: 'transferView',
    sounds: 'soundsView',
    magic: 'magicView',
    brush: 'brushView',
    gallery: 'galleryView',
    printing: 'printingView',
    analysis: 'analysisView'
  };

  // 主流程顺序，用来判断这次切屏是前进还是后退
  var FLOW = [
    'splash', 'collect', 'mySounds', 'transfer', 'sounds', 'magic', 'brush', 'analysis', 'gallery', 'printing'
  ];

  var ANIM_CLASSES = [
    'piko-entering', 'piko-leaving',
    'piko-enter-fwd', 'piko-leave-fwd',
    'piko-enter-back', 'piko-leave-back',
    'piko-enter-fade', 'piko-leave-fade'
  ];

  var LEAVE_MS = 320;
  var pending = null;

  function el(id) { return document.getElementById(id); }

  function clearAnim(node) {
    if (node) node.classList.remove.apply(node.classList, ANIM_CLASSES);
  }

  /** 上一次转场还没收尾就又切屏：立刻把旧屏收掉，避免两屏叠着 */
  function finishPending() {
    if (!pending) return;
    clearTimeout(pending.timer);
    clearAnim(pending.leaving);
    if (pending.leaving) pending.leaving.classList.add('hidden');
    clearAnim(pending.entering);
    pending = null;
  }

  /**
   * @param {string} name 目标屏
   * @param {{ mode?: 'fwd'|'back'|'fade'|'none' }} [options] 不传则按 FLOW 顺序推断方向
   */
  function show(name, options) {
    var prev = window.PikoRouter.current;
    if (prev === name) return;

    finishPending();

    var mode = (options && options.mode) || direction(prev, name);
    var leaving = prev ? el(screens[prev]) : null;
    var entering = el(screens[name]);
    if (!entering && name) {
      console.warn('[PikoRouter] unknown screen:', name);
      return;
    }

    var targetId = screens[name];
    var seen = {};
    Object.keys(screens).forEach(function (key) {
      var id = screens[key];
      if (!id || seen[id]) return;
      seen[id] = true;
      var node = el(id);
      if (!node || node === leaving) return;
      // 按 DOM id 显隐，避免同一节点被多个别名反复 toggle 成 hidden
      node.classList.toggle('hidden', id !== targetId);
    });

    window.PikoRouter.current = name;
    document.dispatchEvent(new CustomEvent('piko:screen', { detail: { screen: name } }));

    if (mode === 'none' || !entering) {
      if (leaving) leaving.classList.add('hidden');
      return;
    }

    if (entering) {
      clearAnim(entering);
      // 强制重排，保证连续切屏时动画能重新播放
      void entering.offsetWidth;
      entering.classList.add('piko-entering', 'piko-enter-' + mode);
    }

    if (leaving) {
      clearAnim(leaving);
      leaving.classList.add('piko-leaving', 'piko-leave-' + mode);
    }

    pending = {
      leaving: leaving,
      entering: entering,
      timer: setTimeout(finishPending, LEAVE_MS + 120)
    };
  }

  function direction(from, to) {
    if (!from) return 'fade';
    if (from === 'splash') return 'fade';
    var a = FLOW.indexOf(from);
    var b = FLOW.indexOf(to);
    if (a < 0 || b < 0) return 'fade';
    return b >= a ? 'fwd' : 'back';
  }

  function goFromSplash() {
    var splash = el(screens.splash);
    if (!splash || splash.classList.contains('hidden')) return;
    show('collect', { mode: 'fade' });
  }

  /** Collect 中央磁贴进入对应流程（由轮播脚本在点中心卡时调用） */
  function goCollect(target) {
    if (target === 'input') {
      // Input → 录音笔上传页 → 完成后进 New Sounds
      show('transfer');
    } else if (target === 'draw') {
      var hasBrushes = window.PlateManager && window.PlateManager.count() > 0;
      if (hasBrushes && window.App && typeof window.App.enterPlateStudio === 'function') {
        show('analysis');
        window.App.enterPlateStudio();
        if (window.PikoCanvasScreen) window.PikoCanvasScreen.activate();
      } else {
        show('sounds');
      }
    } else if (target === 'gallery') {
      show('gallery');
    }
  }

  function bindTiles() {
    // 点击由 pikoCollectCarousel 接管：侧卡旋转、中心卡 goCollect
  }

  /**
   * Collect 屏的等待文案跟随真实 ESP32 状态。
   * 未连接时省略号循环：. → .. → ... → .
   */
  function bindRecorderStatus() {
    var source = el('esp32Status');
    var target = el('collectStatus');
    if (!source || !target) return;

    var DOTS = ['.', '..', '...'];
    var tip = 0;
    var timer = null;
    var dotsEl = null;

    function stopDots() {
      if (timer != null) {
        clearInterval(timer);
        timer = null;
      }
      dotsEl = null;
    }

    function startDots() {
      if (timer != null) return;
      tip = 0;
      target.classList.remove('is-ready');
      target.textContent = '';
      target.appendChild(document.createTextNode('Waiting for Recorder'));
      dotsEl = document.createElement('span');
      dotsEl.className = 'collect-status-dots';
      dotsEl.textContent = DOTS[0];
      target.appendChild(dotsEl);
      timer = setInterval(function () {
        tip = (tip + 1) % DOTS.length;
        if (dotsEl) dotsEl.textContent = DOTS[tip];
      }, 450);
    }

    function sync() {
      var connected = source.dataset.state === 'connected';
      if (connected) {
        stopDots();
        target.classList.add('is-ready');
        target.textContent = 'Recorder is Ready!';
      } else {
        startDots();
      }
    }

    new MutationObserver(sync).observe(source, {
      attributes: true,
      attributeFilter: ['data-state']
    });
    sync();
  }

  function bind() {
    bindTiles();
    bindRecorderStatus();
    bindGallery();
    bindCollectHistory();
    show('splash');
    setTimeout(goFromSplash, SPLASH_MS);
  }

  function bindCollectHistory() {
    var btn = el('collectHistoryBtn');
    if (btn) {
      btn.addEventListener('click', function () {
        show('mySounds');
      });
    }
  }

  function bindGallery() {
    var back = el('galleryBackBtn');
    if (back) {
      back.addEventListener('click', function () {
        show('collect');
      });
    }
  }

  window.PikoRouter = { show: show, goCollect: goCollect, current: null };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
