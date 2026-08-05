/**
 * P4 · Transform（Figma 1:288）
 *
 * 球跟着千问真实 /analyze/wav 等待凝聚；胶囊文案固定「Brush Blooming」。
 * 节奏：慢爬进度 + 每段分析后的停顿 + 成型停留，避免「闪一下就过」。
 */
(function () {
  'use strict';

  var running = false;
  var aborted = false;
  var orb = null;
  var thinkTimer = null;
  var PILL = 'Brush Blooming';

  // 进度时间常数（秒）：越大爬得越慢。千问常见 8–20s，用 16 让中段仍在凝聚
  var THINK_TAU_MS = 16000;
  // 单段分析若异常快结束（失败/缓存），至少撑住这段，避免闪屏
  var MIN_SAMPLE_MS = 3200;
  // 一段完成后的呼吸停顿
  var BETWEEN_MS = 900;
  // 全部完成后的绽放停留
  var BLOOM_HOLD_MS = 1800;

  function el(id) { return document.getElementById(id); }
  function app() { return window.App || null; }

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
    if (!node) return;
    if (node.textContent === text) return;
    node.textContent = text;
  }

  function pendingSamples() {
    var a = app();
    if (!a || !window.PlateManager) return [];
    return window.PlateManager.getSelectedSamples(a) || [];
  }

  function delay(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  /** 千问思考期间：进度渐近逼近 ceiling，永不提前封顶 */
  function startThinkingProgress(view, from, ceiling) {
    stopThinkingProgress();
    if (!view) return;
    var t0 = Date.now();
    thinkTimer = setInterval(function () {
      var t = (Date.now() - t0) / THINK_TAU_MS;
      var p = from + (ceiling - from) * (1 - Math.exp(-t));
      view.setProgress(p);
    }, 100);
  }

  function stopThinkingProgress(view, finalP) {
    if (thinkTimer) {
      clearInterval(thinkTimer);
      thinkTimer = null;
    }
    if (view && finalP != null) view.setProgress(finalP);
  }

  async function run() {
    if (running) return;
    running = true;
    aborted = false;

    var a = app();
    var list = pendingSamples();
    var todo = list.filter(Boolean);
    var total = Math.max(todo.length, 1);

    pillText(PILL);

    var view = ensureOrb();
    if (view) {
      view.reset();
      view.setSample(list[0] || null);
      view.start();
    }

    if (!todo.length) {
      if (view) {
        view.setProgress(1);
        view.bloom();
        await delay(BLOOM_HOLD_MS);
      }
      running = false;
      if (!aborted && window.PikoRouter && window.PikoRouter.current === 'magic') {
        window.PikoRouter.show('brush');
      }
      return;
    }

    try {
      for (var i = 0; i < todo.length; i++) {
        if (aborted) break;
        var sample = todo[i];
        var base = i / total;
        // 留给「快结束」的余量小一点，长时间思考时球一直在后半段慢慢涨
        var ceiling = (i + 0.88) / total;
        var doneAt = (i + 1) / total;
        var sampleStarted = Date.now();

        if (view) {
          view.setSample(sample);
          view.setProgress(base + 0.015);
        }

        var tv = a && a.transformView;
        if (!tv || typeof tv.runHeadless !== 'function') {
          throw new Error('transformView.runHeadless missing');
        }

        startThinkingProgress(view, base + 0.04, ceiling);
        var result = await tv.runHeadless(sample, {
          onPhase: function (phase, detail) {
            if (phase === 'done' || phase === 'mapping') {
              var sem = detail && detail.semantic;
              var err = detail && detail.semanticError;
              if (sem) {
                console.info(
                  '[PikoMagic] Qwen',
                  (sem.archetypeLabelZh || sem.soundLabel || sem.archetype),
                  'conf=',
                  sem.confidence
                );
              } else if (err) {
                console.warn('[PikoMagic] Qwen failed:', err.code || err.message || err);
              }
            }
          }
        });
        stopThinkingProgress(view, doneAt);
        if (aborted) break;
        if (view) view.setSample(sample);

        var elapsed = Date.now() - sampleStarted;
        if (elapsed < MIN_SAMPLE_MS) {
          await delay(MIN_SAMPLE_MS - elapsed);
        }
        if (aborted) break;
        if (i < todo.length - 1) await delay(BETWEEN_MS);

        void result;
      }

      if (aborted) {
        running = false;
        stopThinkingProgress();
        if (view) view.stop();
        return;
      }

      stopThinkingProgress(view, 1);
      if (view) {
        view.setProgress(1);
        view.bloom();
        await delay(BLOOM_HOLD_MS);
      }
    } catch (err) {
      console.error('[Piko] magic/qwen pipeline failed:', err);
      stopThinkingProgress();
      pillText('Something went wrong');
      running = false;
      if (view) view.stop();
      return;
    }

    running = false;
    if (!aborted && window.PikoRouter && window.PikoRouter.current === 'magic') {
      window.PikoRouter.show('brush');
    }
  }

  var stopTimer = null;
  function stopOrbAfterTransition() {
    if (!orb) return;
    clearTimeout(stopTimer);
    stopTimer = setTimeout(function () {
      if (orb && window.PikoRouter && window.PikoRouter.current !== 'magic') orb.stop();
    }, 720);
  }

  function showAbortModal(show) {
    var modal = el('magicAbortModal');
    if (modal) modal.classList.toggle('hidden', !show);
  }

  function requestAbort() {
    if (!window.PikoRouter || window.PikoRouter.current !== 'magic') return;
    if (!running) {
      if (window.PikoRouter) window.PikoRouter.show('sounds');
      return;
    }
    showAbortModal(true);
  }

  function confirmAbort() {
    aborted = true;
    var a = app();
    if (a && a.transformView) a.transformView.running = false;
    stopThinkingProgress();
    showAbortModal(false);
    running = false;
    if (orb) orb.stop();
    if (window.PikoRouter) window.PikoRouter.show('sounds');
  }

  function cancelAbort() {
    showAbortModal(false);
  }

  function bind() {
    var back = el('magicBackBtn');
    if (back) back.addEventListener('click', requestAbort);

    var confirmBtn = el('magicAbortConfirmBtn');
    var cancelBtn = el('magicAbortCancelBtn');
    var backdrop = el('magicAbortBackdrop');
    if (confirmBtn) confirmBtn.addEventListener('click', confirmAbort);
    if (cancelBtn) cancelBtn.addEventListener('click', cancelAbort);
    if (backdrop) backdrop.addEventListener('click', cancelAbort);

    document.addEventListener('piko:screen', function (event) {
      if (!event.detail) return;
      if (event.detail.screen === 'magic') {
        clearTimeout(stopTimer);
        showAbortModal(false);
        pillText(PILL);
        run();
      } else {
        showAbortModal(false);
        stopThinkingProgress();
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
