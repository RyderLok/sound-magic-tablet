/**
 * Collect 三磁贴环形轮播（Coverflow 立体，跟手连续旋转）
 *
 * 位置用一个连续量 pos 表示：pos = 1 表示 Input 在主位。
 * 每张卡的相对位置 u = wrap(index - pos)：-1 左、0 中、1 右，
 * 拖动时 u 连续变化，卡片一路旋转/推远/缩小，松手用弹簧回到整数位。
 *
 * 向左拖 → 右侧卡进主位；向右拖 → 左侧卡进主位。
 * 点侧卡 → 转到主位；点主位 → 进入对应流程。
 */
(function () {
  'use strict';

  var ORDER = ['draw', 'input', 'gallery'];
  var COUNT = ORDER.length;
  var SLOTS = ['is-slot-left', 'is-slot-center', 'is-slot-right'];
  var RING_CENTER = 'piko-assets/tile-circle-ring.svg';
  var RING_SIDE = 'piko-assets/tile-circle-side.svg';

  // Figma 红线：侧卡中心距主位 388px、尺寸 312/350（=0.891）
  // 缩小交给透视后退（perspective 1400 / z=171 恰好投影出 0.891），
  // 所以 SPREAD 要按 1/0.891 预放大，投影后才落在 388。
  var SPREAD = 440;
  var SIDE_SCALE = 1;
  var SIDE_OPACITY = 0.8;
  var ROTATE = 22;      // 侧卡 rotateY，决定「立体感」强弱
  var DEPTH = 171;      // 侧卡后退距离
  var DRAG_PER_SLOT = 300;
  var STIFFNESS = 0.17;
  var DAMPING = 0.74;

  var track = null;
  var tiles = [];
  var pos = 1;
  var target = 1;
  var velocity = 0;
  var raf = null;
  var drag = null;
  var suppressClick = false;
  var suppressTimer = null;
  var lastCenter = -1;

  /** 拖拽后紧跟的那一次 click 要吞掉；若浏览器没补发 click，超时自动解除 */
  function setSuppressClick(on) {
    suppressClick = on;
    clearTimeout(suppressTimer);
    if (on) suppressTimer = setTimeout(function () { suppressClick = false; }, 400);
  }

  /** 把环形差值折到 [-1.5, 1.5]，保证走最短路径 */
  function wrap(d) {
    d = d % COUNT;
    if (d > COUNT / 2) d -= COUNT;
    if (d < -COUNT / 2) d += COUNT;
    return d;
  }

  function normalize(p) {
    return ((p % COUNT) + COUNT) % COUNT;
  }

  function render() {
    for (var i = 0; i < tiles.length; i++) {
      var tile = tiles[i];
      var u = wrap(i - pos);
      var a = Math.abs(u);
      var sign = u < 0 ? -1 : 1;

      var x, scale, opacity;
      if (a <= 1) {
        // 主位 ↔ 侧位：走正弦弧线，像绕着一个圆转过来
        x = SPREAD * Math.sin((u * Math.PI) / 2);
        scale = 1 - (1 - SIDE_SCALE) * a;
        opacity = 1 - (1 - SIDE_OPACITY) * a;
      } else {
        // 越过侧位继续外移并淡出，从另一侧转回来
        var over = Math.min(a - 1, 0.5) / 0.5;
        x = sign * (SPREAD + over * 240);
        scale = SIDE_SCALE * (1 - over * 0.14);
        opacity = SIDE_OPACITY * (1 - over);
      }

      var z = -DEPTH * Math.min(a, 1.2);
      var ry = -ROTATE * Math.max(-1.3, Math.min(1.3, u));

      tile.style.transform =
        'translate3d(' + x.toFixed(2) + 'px, 0, ' + z.toFixed(1) + 'px) ' +
        'rotateY(' + ry.toFixed(2) + 'deg) scale(' + scale.toFixed(4) + ')';
      tile.style.opacity = opacity.toFixed(3);
      tile.style.zIndex = String(100 - Math.round(Math.min(a, 1.5) * 40));
      tile.style.pointerEvents = a > 1.2 ? 'none' : '';
    }

    syncCenterState();
  }

  /** 只在主位换人时改图标环与 aria，避免每帧写 DOM */
  function syncCenterState() {
    var center = normalize(Math.round(pos));
    if (center === lastCenter) return;
    lastCenter = center;

    for (var i = 0; i < tiles.length; i++) {
      var u = wrap(i - center);
      var slot = u === 0 ? 'is-slot-center' : u < 0 ? 'is-slot-left' : 'is-slot-right';
      var tile = tiles[i];

      SLOTS.forEach(function (c) { tile.classList.toggle(c, c === slot); });

      var ring = tile.querySelector('.tile-icon-ring');
      if (ring) ring.src = slot === 'is-slot-center' ? RING_CENTER : RING_SIDE;

      tile.setAttribute('aria-current', slot === 'is-slot-center' ? 'true' : 'false');
    }
  }

  function tick() {
    var diff = wrap(target - pos);
    velocity = (velocity + diff * STIFFNESS) * DAMPING;

    if (Math.abs(diff) < 0.0015 && Math.abs(velocity) < 0.0015) {
      pos = normalize(target);
      velocity = 0;
      raf = null;
      render();
      return;
    }

    pos = normalize(pos + velocity);
    render();
    raf = requestAnimationFrame(tick);
  }

  function startAnim() {
    if (raf == null) raf = requestAnimationFrame(tick);
  }

  function stopAnim() {
    if (raf != null) cancelAnimationFrame(raf);
    raf = null;
    velocity = 0;
  }

  function goTo(index) {
    target = index;
    startAnim();
  }

  function step(delta) {
    goTo(Math.round(pos) + delta);
  }

  function clientX(event) {
    if (event.touches && event.touches[0]) return event.touches[0].clientX;
    if (event.changedTouches && event.changedTouches[0]) return event.changedTouches[0].clientX;
    return event.clientX;
  }

  /** 屏幕像素 → 设计坐标（舞台整体缩放过） */
  function dragScale() {
    var s = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--piko-scale'));
    return s > 0 ? s : 1;
  }

  function onPointerDown(event) {
    if (event.button != null && event.button !== 0) return;
    stopAnim();
    drag = {
      startX: clientX(event),
      startPos: pos,
      lastX: clientX(event),
      lastT: performance.now(),
      vx: 0,
      moved: false,
      scale: dragScale(),
      tile: event.target.closest('.collect-tile')
    };
    setSuppressClick(false);
    track.classList.add('is-dragging');
    if (track.setPointerCapture && event.pointerId != null) {
      try { track.setPointerCapture(event.pointerId); } catch (_) { /* noop */ }
    }
  }

  function onPointerMove(event) {
    if (!drag) return;
    var x = clientX(event);
    var dx = (x - drag.startX) / drag.scale;
    if (Math.abs(x - drag.startX) > 6) drag.moved = true;

    var now = performance.now();
    var dt = now - drag.lastT;
    if (dt > 0) drag.vx = (x - drag.lastX) / drag.scale / dt;
    drag.lastX = x;
    drag.lastT = now;

    pos = normalize(drag.startPos - dx / DRAG_PER_SLOT);
    render();
  }

  /** 三张卡都是入口：转到主位并进入对应流程 */
  function activate(tile) {
    var index = tiles.indexOf(tile);
    if (index < 0) return;

    goTo(Math.round(pos) + wrap(index - Math.round(pos)));

    if (window.PikoRouter && typeof window.PikoRouter.goCollect === 'function') {
      window.PikoRouter.goCollect(tile.dataset.pikoGo);
    }
  }

  function onPointerUp(event) {
    if (!drag) return;
    var dx = (clientX(event) - drag.startX) / drag.scale;
    track.classList.remove('is-dragging');

    var base = Math.round(drag.startPos);
    var tapped = drag.moved ? null : drag.tile;
    var fling = -drag.vx * 90 / DRAG_PER_SLOT;          // 甩动惯性
    var landed = drag.startPos - dx / DRAG_PER_SLOT + fling;
    var delta = Math.max(-1, Math.min(1, Math.round(landed - base)));

    drag = null;
    // 点击在这里判定；浏览器随后补发的 click 一律吞掉，避免重复触发
    setSuppressClick(true);

    if (tapped) {
      activate(tapped);
      return;
    }

    goTo(base + delta);
  }

  function onPointerCancel() {
    if (!drag) return;
    var base = Math.round(drag.startPos);
    track.classList.remove('is-dragging');
    drag = null;
    goTo(base);
  }

  /** 键盘激活（Enter / Space）不产生 pointer 事件，仍走 click */
  function onClick(event) {
    if (suppressClick) {
      setSuppressClick(false);
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    var tile = event.target.closest('.collect-tile');
    if (!tile || !track.contains(tile)) return;

    activate(tile);
  }

  /** 触控板横向滑动 */
  var wheelAcc = 0;
  var wheelTimer = null;
  function onWheel(event) {
    if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
    event.preventDefault();
    wheelAcc += event.deltaX;
    if (Math.abs(wheelAcc) > 60) {
      step(wheelAcc > 0 ? 1 : -1);
      wheelAcc = 0;
    }
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(function () { wheelAcc = 0; }, 200);
  }

  function bind() {
    track = document.getElementById('collectTiles');
    if (!track) return;
    tiles = Array.prototype.slice.call(track.querySelectorAll('.collect-tile'));
    if (tiles.length !== COUNT) return;

    // DOM 顺序即 ORDER 顺序
    tiles.sort(function (a, b) {
      return ORDER.indexOf(a.dataset.pikoGo) - ORDER.indexOf(b.dataset.pikoGo);
    });

    render();

    track.addEventListener('pointerdown', onPointerDown);
    track.addEventListener('pointermove', onPointerMove);
    track.addEventListener('pointerup', onPointerUp);
    track.addEventListener('pointercancel', onPointerCancel);
    track.addEventListener('click', onClick, true);
    track.addEventListener('wheel', onWheel, { passive: false });

    document.addEventListener('keydown', function (event) {
      var collect = document.getElementById('collectView');
      if (!collect || collect.classList.contains('hidden')) return;

      if (event.key === 'ArrowRight') {
        event.preventDefault();
        step(1);
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        step(-1);
      } else if (event.key === 'Enter') {
        var center = track.querySelector('.is-slot-center');
        if (center && window.PikoRouter) window.PikoRouter.goCollect(center.dataset.pikoGo);
      }
    });

    window.PikoCollectCarousel = {
      goTo: goTo,
      step: step,
      slideToGo: function (go) {
        var idx = ORDER.indexOf(go);
        if (idx >= 0) step(wrap(idx - Math.round(pos)));
      }
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
