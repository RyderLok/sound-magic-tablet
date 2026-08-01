/**
 * P4 · Transform（Figma 1:288）
 *
 * 只做 Figma 的加载屏外观；真正的「声音 → 笔刷」仍由既有的
 * SoundTransformView 管线跑完，本屏负责编排顺序与进度文案。
 */
(function () {
  'use strict';

  var MIN_SHOW_MS = 2600; // shader 球至少完整凝聚一轮，别让等待变闪屏

  var running = false;
  var orb = null;

  function el(id) { return document.getElementById(id); }
  function app() { return window.App || null; }

  /** shader 球：WebGL 不可用时静默回退到 Figma 的 PNG */
  function ensureOrb() {
    if (orb) return orb;
    var host = el('magicOrbWrap');
    if (!host || typeof window.PikoOrb !== 'function') return null;
    var instance = new window.PikoOrb(host);
    orb = instance.init() ? instance : null;
    return orb;
  }

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

    var view = ensureOrb();
    if (view) {
      view.reset();
      view.setSample(list[0] || null);
      view.start();
    }

    // 已分析过的直接进成型态，否则从「声音云」开始凝聚
    var total = todo.length;
    if (view && total === 0) view.setProgress(1);

    try {
      for (var i = 0; i < total; i++) {
        pillText('Brush Blooming ' + (i + 1) + '/' + total);
        if (view) {
          view.setSample(todo[i]);
          view.setProgress((i + 0.15) / total);
        }
        if (a && a.transformView && typeof a.transformView.start === 'function') {
          await a.transformView.start(todo[i]);
        }
        // 分析回填了 visualParams，用真实调色板再刷一次球
        if (view) {
          view.setSample(todo[i]);
          view.setProgress((i + 1) / total);
        }
      }
      pillText('Brush Blooming');
    } catch (err) {
      console.error('[Piko] transform pipeline failed:', err);
      pillText('Something went wrong');
      running = false;
      if (view) view.stop();
      return;
    }

    var elapsed = Date.now() - startedAt;
    if (elapsed < MIN_SHOW_MS) await delay(MIN_SHOW_MS - elapsed);

    // 成型：柔和绽放再进 Sound Brush。
    // 这里不能 stop()——离场还有几百毫秒，停了球会僵住，看起来像「流着流着突然卡住」。
    // 收尾交给 piko:screen 的延迟停止；bloom 衰减也放慢，避免爆发后立刻发呆。
    if (view) {
      view.setProgress(1);
      view.bloom();
      await delay(720);
    }

    running = false;
    // 用户可能在管线跑完前就退了；别把人从别的屏拽回来
    if (window.PikoRouter && window.PikoRouter.current === 'magic') {
      window.PikoRouter.show('brush');
    }
  }

  /** 让球继续动完整个离场动画再收，避免切屏时画面僵住 */
  var stopTimer = null;
  function stopOrbAfterTransition() {
    if (!orb) return;
    clearTimeout(stopTimer);
    stopTimer = setTimeout(function () {
      if (orb && window.PikoRouter && window.PikoRouter.current !== 'magic') orb.stop();
    }, 640);
  }

  function bind() {
    var back = el('magicBackBtn');
    if (back) {
      back.addEventListener('click', function () {
        if (window.PikoRouter) window.PikoRouter.show('sounds');
      });
    }

    document.addEventListener('piko:screen', function (event) {
      if (!event.detail) return;
      if (event.detail.screen === 'magic') {
        clearTimeout(stopTimer);
        pillText('Brush Blooming');
        run();
      } else {
        stopOrbAfterTransition();
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
