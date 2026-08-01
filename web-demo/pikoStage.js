/**
 * Piko 舞台缩放
 * 界面按 Figma 设计基准 1055×834 布局，运行时整体等比缩放贴合窗口。
 * 这样各屏可直接用 design.md 红线表里的绝对坐标实现。
 */
(function () {
  'use strict';

  var DESIGN_W = 1055;
  var DESIGN_H = 834;

  var root = document.documentElement;

  function fit() {
    var scale = Math.min(window.innerWidth / DESIGN_W, window.innerHeight / DESIGN_H);
    root.style.setProperty('--piko-scale', String(scale));
  }

  fit();
  window.addEventListener('resize', fit);
  window.addEventListener('orientationchange', fit);

  window.PikoStage = {
    designWidth: DESIGN_W,
    designHeight: DESIGN_H,
    fit: fit
  };
})();
