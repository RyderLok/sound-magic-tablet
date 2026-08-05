/**
 * P8 · Printing（Figma 1:644）
 * My Gallery 多选 → Print → 打印进度 → 完成后返回 Gallery。
 */
(function () {
  'use strict';

  var raf = null;
  var t0 = 0;
  var DURATION_MS = 4200;
  var FINISH_HOLD_MS = 900;
  var finishTimer = null;

  var DOTS = ['.', '..', '...'];
  var dotsTimer = null;
  var dotsStep = 0;

  function el(id) { return document.getElementById(id); }

  function startDots() {
    if (dotsTimer != null) return;
    var target = el('printingStatusDots');
    if (!target) return;
    dotsStep = 0;
    target.textContent = DOTS[0];
    dotsTimer = setInterval(function () {
      dotsStep = (dotsStep + 1) % DOTS.length;
      target.textContent = DOTS[dotsStep];
    }, 450);
  }

  function stopDots() {
    if (dotsTimer != null) { clearInterval(dotsTimer); dotsTimer = null; }
    var target = el('printingStatusDots');
    if (target) target.textContent = DOTS[DOTS.length - 1];
  }

  function setProgress(p) {
    p = Math.max(0, Math.min(1, p));
    var text = el('printingProgressText');
    if (!text) return;
    if (p >= 1) {
      text.textContent = 'DONE';
      text.classList.add('is-finish');
    } else {
      text.textContent = Math.round(p * 100) + '%';
      text.classList.remove('is-finish');
    }
    var wrap = el('printingView');
    if (wrap) wrap.style.setProperty('--print-p', p.toFixed(3));
  }

  function stop() {
    stopDots();
    if (raf != null) { cancelAnimationFrame(raf); raf = null; }
    if (finishTimer != null) { clearTimeout(finishTimer); finishTimer = null; }
  }

  function tick(now) {
    var t = (now - t0) / DURATION_MS;
    var eased = 1 - Math.pow(1 - Math.min(1, t), 1.55);
    setProgress(Math.min(0.99, eased));
    if (t >= 1) {
      setProgress(1);
      stopDots();
      finishTimer = setTimeout(function () {
        finishTimer = null;
        if (window.PikoRouter) window.PikoRouter.show('gallery');
      }, FINISH_HOLD_MS);
      return;
    }
    raf = requestAnimationFrame(tick);
  }

  function start() {
    stop();
    setProgress(0);
    startDots();
    t0 = performance.now();
    raf = requestAnimationFrame(tick);
  }

  document.addEventListener('piko:screen', function (ev) {
    var screen = ev.detail && ev.detail.screen;
    if (screen === 'printing') start();
    else stop();
  });
})();
