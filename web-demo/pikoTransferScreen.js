/**
 * P2b · Collect Transfer
 *
 * Collect → Input：用 Figma P2 设备 / P3 笔展示上传；
 * 波形对应当前正在上传的那一段声音；完成 → My Sounds；
 * Mid-transfer back → confirm “Stop the transfer?”.
 */
(function () {
  'use strict';

  var running = false;
  var aborted = false;
  var paused = false;
  var raf = null;
  var progress = 0;
  var finishHoldTimer = null;
  var completedOnce = false;
  var queue = [];
  var currentIndex = -1;
  var t0 = 0;
  var pausedAt = 0;

  var DURATION_MS = 5600;
  var FINISH_HOLD_MS = 900;
  var BAR_COUNT = 47;
  var SYNC_TIMEOUT_MS = 45000;
  var syncPromise = null;
  var syncDone = false;
  var syncError = null;

  var DOTS = ['.', '..', '...'];
  var DOTS_INTERVAL_MS = 450;
  var dotsTimer = null;
  var dotsStep = 0;

  function el(id) { return document.getElementById(id); }

  function startDots() {
    if (dotsTimer != null) return;
    var target = el('transferStatusDots');
    if (!target) return;
    dotsStep = 0;
    target.textContent = DOTS[0];
    dotsTimer = setInterval(function () {
      dotsStep = (dotsStep + 1) % DOTS.length;
      target.textContent = DOTS[dotsStep];
    }, DOTS_INTERVAL_MS);
  }

  function stopDots() {
    if (dotsTimer != null) {
      clearInterval(dotsTimer);
      dotsTimer = null;
    }
    var target = el('transferStatusDots');
    if (target) target.textContent = DOTS[DOTS.length - 1];
  }

  function setProgress(p) {
    progress = Math.max(0, Math.min(1, p));
    var text = el('transferProgressText');
    if (!text) return;
    if (progress >= 1) {
      text.textContent = 'FINISH';
      text.classList.add('is-finish');
    } else {
      text.textContent = Math.round(progress * 100) + '%';
      text.classList.remove('is-finish');
    }
  }

  function showAbortModal(show) {
    var modal = el('transferAbortModal');
    if (!modal) return;
    modal.classList.toggle('hidden', !show);
  }

  function stopLoop() {
    stopDots();
    if (raf != null) {
      cancelAnimationFrame(raf);
      raf = null;
    }
    if (finishHoldTimer != null) {
      clearTimeout(finishHoldTimer);
      finishHoldTimer = null;
    }
    running = false;
  }

  function goSounds() {
    stopLoop();
    showAbortModal(false);
    if (window.PikoRouter) window.PikoRouter.show('sounds');
  }

  function goCollect() {
    stopLoop();
    showAbortModal(false);
    setProgress(0);
    currentIndex = -1;
    // P2 返回 → P3 Collect 首页
    if (window.PikoRouter) window.PikoRouter.show('collect');
  }

  /** 从库里取待上传队列；无录音时用可辨识的合成波，保证每段波形不同 */
  function buildQueue() {
    var lib = (window.App && Array.isArray(window.App.soundLibrary))
      ? window.App.soundLibrary.slice()
      : [];
    var withWave = lib.filter(function (s) {
      return s && s.waveformSnapshot && s.waveformSnapshot.length;
    });
    if (withWave.length) {
      // 模拟「笔里待传」：最多 5 段，按时间新→旧
      return withWave.slice(0, 5).map(function (s) {
        var dur = Number(s.duration);
        if (!(dur > 0.2)) dur = 2;
        return {
          id: s.id,
          name: s.name || s.label || 'Sound',
          data: Float32Array.from(s.waveformSnapshot),
          durationMs: Math.round(dur * 1000)
        };
      });
    }
    return [0, 1, 2].map(function (i) {
      return {
        id: 'demo-' + i,
        name: 'Sound ' + (i + 1),
        data: synthWave(i),
        durationMs: 2000 + i * 400
      };
    });
  }

  function synthWave(seed) {
    var n = 160;
    var out = new Float32Array(n);
    for (var i = 0; i < n; i++) {
      var t = i / (n - 1);
      var env = Math.sin(Math.PI * t);
      out[i] = env * (
        0.55 * Math.sin((6 + seed * 3) * Math.PI * t) +
        0.3 * Math.sin((14 + seed * 5) * Math.PI * t + seed) +
        0.15 * Math.sin((28 + seed) * Math.PI * t)
      );
    }
    return out;
  }

  /**
   * Figma 59:83 · Union 波形几何。
   * 波形时钟与下方 % 完全独立：按当前录音 duration 自然扫过
   * waveformSnapshot（循环）；% 只负责上传进度数字。
   */
  var WAVE_PITCH = 6.0652;
  var WAVE_STROKE = 3;
  var WAVE_MIN_H = 8.92;
  var WAVE_MAX_H = 44.59;
  var WAVE_RISE = 0.42;
  var WAVE_FALL = 0.18;

  var currentHeights = new Array(BAR_COUNT).fill(WAVE_MIN_H);
  var targetHeights = new Array(BAR_COUNT).fill(WAVE_MIN_H);
  var waveGrad = null;
  var waveGradW = 0;
  var activeWaveData = null;
  var activeWaveDurationMs = 2000;
  var waveT0 = 0;
  var wavePauseAccum = 0;

  function waveCtx(canvas) {
    var cssW = canvas.clientWidth || parseFloat(canvas.getAttribute('width')) || 282;
    var cssH = canvas.clientHeight || parseFloat(canvas.getAttribute('height')) || 48;
    var dpr = window.devicePixelRatio || 1;
    var needW = Math.round(cssW * dpr);
    var needH = Math.round(cssH * dpr);
    if (canvas.width !== needW || canvas.height !== needH) {
      canvas.width = needW;
      canvas.height = needH;
      waveGrad = null;
    }
    var ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: ctx, w: cssW, h: cssH };
  }

  /** 播放头 0→1，按录音真实时长走并可循环；与上传 % 无关 */
  function wavePlayhead(now) {
    var dur = Math.max(200, activeWaveDurationMs || 2000);
    var elapsed = Math.max(0, (now || performance.now()) - waveT0 - wavePauseAccum);
    return (elapsed % dur) / dur;
  }

  function sampleTargets(data, playhead) {
    if (!data || !data.length) {
      for (var z = 0; z < BAR_COUNT; z++) targetHeights[z] = WAVE_MIN_H;
      return;
    }
    var n = data.length;
    var maxStart = Math.max(0, n - BAR_COUNT);
    var start = Math.floor(Math.max(0, Math.min(1, playhead)) * maxStart);
    var loudest = 0;
    for (var s = 0; s < n; s++) {
      var av = Math.abs(data[s] || 0);
      if (av > loudest) loudest = av;
    }
    var norm = loudest > 1e-4 ? 1 / loudest : 0;
    var step = Math.max(1, Math.floor(n / Math.max(BAR_COUNT * 3, 1)));
    var span = Math.max(1, Math.floor((n - start) / BAR_COUNT));
    for (var i = 0; i < BAR_COUNT; i++) {
      var idx = Math.min(n - 1, start + i * span);
      var peak = 0;
      var a0 = Math.max(0, idx - step);
      var a1 = Math.min(n, idx + step + 1);
      for (var j = a0; j < a1; j++) {
        var v = Math.abs(data[j] || 0);
        if (v > peak) peak = v;
      }
      var amp = Math.min(1, peak * norm);
      targetHeights[i] = WAVE_MIN_H + amp * (WAVE_MAX_H - WAVE_MIN_H);
    }
  }

  function paintWave() {
    var canvas = el('transferWaveCanvas');
    if (!canvas) return;
    var view = waveCtx(canvas);
    if (!view) return;
    var ctx = view.ctx;
    var mid = view.h / 2;
    for (var i = 0; i < BAR_COUNT; i++) {
      var diff = targetHeights[i] - currentHeights[i];
      currentHeights[i] += diff * (diff > 0 ? WAVE_RISE : WAVE_FALL);
    }
    if (!waveGrad || waveGradW !== view.w) {
      waveGrad = ctx.createLinearGradient(0, 0, view.w, 0);
      waveGrad.addColorStop(0, '#F16E1C');
      waveGrad.addColorStop(1, '#FDBF42');
      waveGradW = view.w;
    }
    ctx.clearRect(0, 0, view.w, view.h);
    ctx.strokeStyle = waveGrad;
    ctx.lineWidth = WAVE_STROKE;
    ctx.lineCap = 'round';
    var half = WAVE_STROKE / 2;
    for (var k = 0; k < BAR_COUNT; k++) {
      var barH = currentHeights[k];
      var x = half + k * WAVE_PITCH;
      if (x > view.w - half) break;
      ctx.beginPath();
      ctx.moveTo(x, mid - barH / 2 + half);
      ctx.lineTo(x, mid + barH / 2 - half);
      ctx.stroke();
    }
  }

  /** 只按上传 % 切换「当前哪一段」；播放头由独立时钟驱动 */
  function syncActiveSound(p) {
    if (!queue.length) {
      currentIndex = -1;
      activeWaveData = null;
      return;
    }
    var idx = Math.min(queue.length - 1, Math.floor(p * queue.length));
    if (p >= 0.995) idx = queue.length - 1;
    if (idx !== currentIndex) {
      currentIndex = idx;
      activeWaveData = queue[idx].data;
      activeWaveDurationMs = queue[idx].durationMs || 2000;
      waveT0 = performance.now();
      wavePauseAccum = 0;
    }
  }

  function tickWave(now) {
    if (!activeWaveData) sampleTargets(null, 0);
    else sampleTargets(activeWaveData, wavePlayhead(now));
    paintWave();
  }

  function complete() {
    if (paused || aborted || completedOnce) return;
    completedOnce = true;
    setProgress(1);
    stopDots();
    running = false;
    if (raf != null) {
      cancelAnimationFrame(raf);
      raf = null;
    }
    var status = el('transferStatus');
    if (status && syncError) {
      var live = el('transferStatusDots');
      if (live) live.textContent = '';
    }
    if (finishHoldTimer != null) {
      clearTimeout(finishHoldTimer);
      finishHoldTimer = null;
    }
    finishHoldTimer = setTimeout(function () {
      finishHoldTimer = null;
      if (!aborted && !paused) {
        if (syncError) {
          if (window.PikoRouter) window.PikoRouter.show('collect');
        } else {
          goSounds();
        }
      }
    }, FINISH_HOLD_MS);
  }

  function tick(now) {
    if (!running || aborted) return;
    if (paused) {
      paintWave();
      raf = requestAnimationFrame(tick);
      return;
    }

    // Visual progress tracks real sync: crawl to 90% until syncDone, then finish.
    var elapsed = now - t0;
    var visualCap = syncDone ? 1 : 0.9;
    var eased = 1 - Math.pow(1 - Math.min(1, elapsed / DURATION_MS), 1.55);
    var p = Math.min(visualCap, eased);
    if (syncDone) p = Math.max(p, 0.92);
    setProgress(p);
    syncActiveSound(p);
    tickWave(now);

    if (syncDone && (p >= 0.99 || elapsed > DURATION_MS)) {
      setProgress(1);
      syncActiveSound(1);
      tickWave(now);
      complete();
      return;
    }
    if (!syncDone && elapsed > SYNC_TIMEOUT_MS) {
      syncError = syncError || new Error('Sync timeout');
      syncDone = true;
    }
    raf = requestAnimationFrame(tick);
  }

  /**
   * Sync may finish while rAF is throttled (background / embedded preview).
   * Don't rely on tick alone — force progress + finish on a timer.
   */
  function onSyncSettled() {
    syncDone = true;
    if (aborted || paused) return;
    if (!running) return;
    // Jump out of the stuck 0% state immediately.
    if (progress < 0.92) {
      setProgress(0.92);
      syncActiveSound(0.92);
      tickWave(performance.now());
    }
    // Short bloom, then FINISH → My Sounds (even if rAF never fires again).
    if (finishHoldTimer != null) clearTimeout(finishHoldTimer);
    finishHoldTimer = setTimeout(function () {
      finishHoldTimer = null;
      if (aborted || paused) return;
      if (!running && progress >= 1) return;
      setProgress(1);
      syncActiveSound(1);
      tickWave(performance.now());
      complete();
    }, 700);
  }

  function beginBackendSync() {
    syncDone = false;
    syncError = null;
    var client = window.SoundsApiClient;
    var app = window.App;
    if (!client || typeof client.syncIntoApp !== 'function' || !app) {
      syncError = new Error('Sounds API unavailable');
      onSyncSettled();
      return;
    }
    if (typeof client.beginTransferSession === 'function') {
      client.beginTransferSession();
    }
    var statusEl = el('transferStatus');
    if (statusEl) {
      stopDots();
      statusEl.textContent = 'Syncing your sounds';
      var dots = document.createElement('span');
      dots.className = 'transfer-status-dots';
      var ghost = document.createElement('span');
      ghost.className = 'transfer-status-dots-ghost';
      ghost.textContent = '…';
      var live = document.createElement('span');
      live.id = 'transferStatusDots';
      live.className = 'transfer-status-dots-live';
      live.setAttribute('aria-hidden', 'true');
      live.textContent = '...';
      dots.appendChild(ghost);
      dots.appendChild(live);
      statusEl.appendChild(dots);
      startDots();
    }
    syncPromise = client.syncIntoApp(app)
      .then(function (result) {
        if (typeof client.commitTransferBatch === 'function') {
          client.commitTransferBatch(app, result);
        }
        if (window.PikoSoundsScreen && typeof window.PikoSoundsScreen.render === 'function') {
          window.PikoSoundsScreen.render();
        }
        if (app.renderLibrary) app.renderLibrary();
        console.info('[transfer] synced sounds', result && result.total, 'imported', result && result.imported);
        if (statusEl) {
          var n = (result && result.imported) || 0;
          var total = (result && result.total) || 0;
          var batchLen = 0;
          try {
            batchLen = (client.loadLatestBatch && client.loadLatestBatch()) || [];
            batchLen = batchLen.length || 0;
          } catch (e) { batchLen = 0; }
          stopDots();
          if (n > 0) {
            statusEl.textContent = 'Imported ' + n + ' sound' + (n === 1 ? '' : 's');
          } else if (batchLen > 0 || total > 0) {
            statusEl.textContent = 'All set — opening your sounds';
          } else {
            statusEl.textContent = 'No new sounds yet';
          }
        }
      })
      .catch(function (err) {
        console.error('[transfer] sync failed', err);
        syncError = err;
        if (statusEl) {
          stopDots();
          statusEl.textContent = 'Upload failed — start Python (:8001) and retry';
        }
      })
      .finally(function () {
        onSyncSettled();
      });
  }

  function start() {
    stopLoop();
    aborted = false;
    paused = false;
    running = true;
    completedOnce = false;
    currentIndex = -1;
    activeWaveData = null;
    wavePauseAccum = 0;
    syncDone = false;
    syncError = null;
    for (var i = 0; i < BAR_COUNT; i++) {
      currentHeights[i] = WAVE_MIN_H;
      targetHeights[i] = WAVE_MIN_H;
    }
    queue = buildQueue();
    showAbortModal(false);
    setProgress(0);
    syncActiveSound(0);
    waveT0 = performance.now();
    tickWave(waveT0);

    startDots();
    beginBackendSync();
    t0 = performance.now();
    raf = requestAnimationFrame(tick);
  }

  function requestAbort() {
    // 仅在上传屏可打断
    if (!window.PikoRouter || window.PikoRouter.current !== 'transfer') return;
    if (!running && progress < 1) {
      goCollect();
      return;
    }
    paused = true;
    stopDots();
    pausedAt = performance.now();
    // 波形播放头也暂停（用 wavePauseAccum 在恢复时扣掉）
    if (finishHoldTimer != null) {
      clearTimeout(finishHoldTimer);
      finishHoldTimer = null;
    }
    showAbortModal(true);
  }

  function confirmAbort() {
    aborted = true;
    paused = false;
    stopLoop();
    showAbortModal(false);
    setProgress(0);
    currentIndex = -1;
    goCollect();
  }

  function cancelAbort() {
    showAbortModal(false);
    if (!running && progress >= 1) {
      // FINISH 停留时被打断又继续 → 再等一会进 My Sounds
      finishHoldTimer = setTimeout(function () {
        finishHoldTimer = null;
        if (!aborted) goSounds();
      }, FINISH_HOLD_MS);
      return;
    }
    if (paused) {
      // 把暂停耗时从计时里扣掉，进度接着走
      var pauseMs = performance.now() - pausedAt;
      t0 += pauseMs;
      wavePauseAccum += pauseMs;
      paused = false;
      startDots();
    }
  }

  function bind() {
    var back = el('transferBackBtn');
    if (back) back.addEventListener('click', requestAbort);

    var confirmBtn = el('transferAbortConfirmBtn');
    var cancelBtn = el('transferAbortCancelBtn');
    var backdrop = el('transferAbortBackdrop');
    if (confirmBtn) confirmBtn.addEventListener('click', confirmAbort);
    if (cancelBtn) cancelBtn.addEventListener('click', cancelAbort);
    if (backdrop) backdrop.addEventListener('click', cancelAbort);

    document.addEventListener('piko:screen', function (ev) {
      var screen = ev.detail && ev.detail.screen;
      if (screen === 'transfer') {
        start();
      } else if (running || finishHoldTimer) {
        stopLoop();
        showAbortModal(false);
      }
    });
  }

  window.PikoTransferScreen = {
    start: start,
    abort: requestAbort,
    isRunning: function () { return running; }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
