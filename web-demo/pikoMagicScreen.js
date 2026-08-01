/**
 * P4 · Transform（Figma 1:288）
 *
 * 只做 Figma 的加载屏外观；真正的「声音 → 笔刷」仍由既有的
 * SoundTransformView 管线跑完，本屏负责编排顺序与进度文案。
 */
(function () {
  'use strict';

  var MIN_SHOW_MS = 1600; // 保证动画至少完整播一轮，避免闪屏

  var running = false;

  function el(id) { return document.getElementById(id); }
  function app() { return window.App || null; }

  function pillText(text) {
    var node = el('magicPillText');
    if (node) node.textContent = text;
  }

  function pendingSamples() {
    var a = app();
    if (!a || !window.PlateManager) return [];
    return window.PlateManager.getSelectedSamples(a) || [];
  }

  function needsTransform(sample) {
    return !(sample && sample.status === 'analyzed' && sample.features && sample.visualParams);
  }

  function delay(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  async function run() {
    if (running) return;
    running = true;

    var startedAt = Date.now();
    var a = app();
    var list = pendingSamples();
    var todo = list.filter(needsTransform);

    try {
      for (var i = 0; i < todo.length; i++) {
        pillText('Brush Blooming ' + (i + 1) + '/' + todo.length);
        if (a && a.transformView && typeof a.transformView.start === 'function') {
          await a.transformView.start(todo[i]);
        }
      }
      pillText('Brush Blooming');
    } catch (err) {
      console.error('[Piko] transform pipeline failed:', err);
      pillText('Something went wrong');
      running = false;
      return;
    }

    var elapsed = Date.now() - startedAt;
    if (elapsed < MIN_SHOW_MS) await delay(MIN_SHOW_MS - elapsed);

    running = false;
    if (window.PikoRouter) window.PikoRouter.show('brush');
  }

  function bind() {
    var back = el('magicBackBtn');
    if (back) {
      back.addEventListener('click', function () {
        if (window.PikoRouter) window.PikoRouter.show('sounds');
      });
    }

    document.addEventListener('piko:screen', function (event) {
      if (event.detail && event.detail.screen === 'magic') {
        pillText('Brush Blooming');
        run();
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
