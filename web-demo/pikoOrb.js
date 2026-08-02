/**
 * Piko Transform Orb — 声音凝结成笔刷材质的加载球
 *
 * 架构：JS soft-blob 色团物理 + WebGL metaball 着色（不是纯噪声球）。
 *
 * 开源/论文技法整合（在既有球上强化，不换引擎）：
 *   · Charlotte Dann soft-blob —— 压力 / 斥力 / 张力（色团物理）
 *   · Bridson et al. curl-noise —— 无散度流场，流体感来源
 *   · 多层 fbm curl（PlasmaZones / curl-flow 一类做法）—— 大涡 + 细涡
 *   · Domain warping（IQ / lava-lamp shader 常见）—— 色带被流场拖拽
 *   · Metaball 场融合 —— 色团指数权重，边界像液滴合并
 *   · IGN 抖动（Jimenez）—— 抗色带
 *
 * 观感目标：橙 / 黄 / 蓝三色在球内流动；边缘实、不发虚。
 */
(function () {
  'use strict';

  var LOBES = 6;

  var VERT = [
    'attribute vec2 a_pos;',
    'void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }'
  ].join('\n');

  var FRAG = [
    'precision highp float;',
    '#define LOBES ' + LOBES,

    'uniform vec2  u_res;',
    'uniform float u_time;',
    'uniform float u_progress;',
    'uniform float u_burst;',
    'uniform float u_energy;',
    'uniform float u_bright;',
    'uniform float u_rough;',
    'uniform float u_breath;',
    'uniform vec4  u_lobes[LOBES];',
    'uniform vec3  u_c0;',
    'uniform vec3  u_c1;',
    'uniform vec3  u_c2;',
    'uniform vec3  u_c3;',

    'vec3 hash3(vec3 p) {',
    '  p = vec3(dot(p, vec3(127.1, 311.7, 74.7)),',
    '           dot(p, vec3(269.5, 183.3, 246.1)),',
    '           dot(p, vec3(113.5, 271.9, 124.6)));',
    '  return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);',
    '}',

    'float gnoise(vec3 p) {',
    '  vec3 i = floor(p);',
    '  vec3 f = fract(p);',
    '  vec3 u = f * f * (3.0 - 2.0 * f);',
    '  float n000 = dot(hash3(i + vec3(0.0, 0.0, 0.0)), f - vec3(0.0, 0.0, 0.0));',
    '  float n100 = dot(hash3(i + vec3(1.0, 0.0, 0.0)), f - vec3(1.0, 0.0, 0.0));',
    '  float n010 = dot(hash3(i + vec3(0.0, 1.0, 0.0)), f - vec3(0.0, 1.0, 0.0));',
    '  float n110 = dot(hash3(i + vec3(1.0, 1.0, 0.0)), f - vec3(1.0, 1.0, 0.0));',
    '  float n001 = dot(hash3(i + vec3(0.0, 0.0, 1.0)), f - vec3(0.0, 0.0, 1.0));',
    '  float n101 = dot(hash3(i + vec3(1.0, 0.0, 1.0)), f - vec3(1.0, 0.0, 1.0));',
    '  float n011 = dot(hash3(i + vec3(0.0, 1.0, 1.0)), f - vec3(0.0, 1.0, 1.0));',
    '  float n111 = dot(hash3(i + vec3(1.0, 1.0, 1.0)), f - vec3(1.0, 1.0, 1.0));',
    '  float nx00 = mix(n000, n100, u.x);',
    '  float nx10 = mix(n010, n110, u.x);',
    '  float nx01 = mix(n001, n101, u.x);',
    '  float nx11 = mix(n011, n111, u.x);',
    '  float nxy0 = mix(nx00, nx10, u.y);',
    '  float nxy1 = mix(nx01, nx11, u.y);',
    '  return mix(nxy0, nxy1, u.z);',
    '}',

    'float fbm(vec2 p, float t) {',
    '  float a = 0.0;',
    '  a += gnoise(vec3(p, t)) * 0.55;',
    '  a += gnoise(vec3(p * 2.1 + 1.7, t * 1.2)) * 0.30;',
    '  a += gnoise(vec3(p * 4.3 - 2.2, t * 1.7)) * 0.15;',
    '  return a;',
    '}',

    'vec2 curl2(vec2 p, float t) {',
    '  float e = 0.014;',
    '  float n1 = gnoise(vec3(p + vec2(e, 0.0), t));',
    '  float n2 = gnoise(vec3(p - vec2(e, 0.0), t));',
    '  float n3 = gnoise(vec3(p + vec2(0.0, e), t));',
    '  float n4 = gnoise(vec3(p - vec2(0.0, e), t));',
    '  return vec2((n3 - n4) / (2.0 * e), -(n1 - n2) / (2.0 * e));',
    '}',

    'vec2 curlFbm(vec2 p, float t) {',
    '  vec2 f = curl2(p, t * 0.50) * 1.0;',
    '  f += curl2(p * 1.8 + vec2(2.1, 0.4), t * 0.80) * 0.50;',
    '  f += curl2(p * 3.4 - vec2(1.3, 0.9), t * 1.15) * 0.24;',
    '  return f;',
    '}',

    // tone: ~0 橙 / ~0.5 黄 / ~1 蓝 —— 软过渡，偏梦幻
    'vec3 lobeColor(float tone) {',
    '  tone = clamp(tone, 0.0, 1.0);',
    '  vec3 warm = mix(u_c0, u_c1, smoothstep(0.12, 0.52, tone));',
    '  return mix(warm, u_c2, smoothstep(0.42, 0.88, tone));',
    '}',

    'float ign(vec2 p) {',
    '  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));',
    '}',

    'void main() {',
    '  vec2 uv = (gl_FragCoord.xy - 0.5 * u_res) / min(u_res.x, u_res.y);',
    '  float t = u_time;',
    '  float prog = clamp(u_progress, 0.0, 1.0);',

    '  float breath = u_breath * 0.008;',
    '  float radius = mix(0.255, 0.302, prog) + u_burst * 0.022 + breath;',
    '  float edgeAmp = 0.008 + u_energy * 0.006;',
    '  float rEdge = radius * (1.0 + gnoise(vec3(uv * 1.1, t * 0.09)) * edgeAmp);',

    '  float d = length(uv);',
    '  float softIn = 0.022;',
    '  float softOut = 0.012;',
    '  float mask = 1.0 - smoothstep(rEdge - softIn, rEdge + softOut, d);',
    '  if (mask <= 0.001) { gl_FragColor = vec4(0.0); return; }',

    '  float rn = clamp(d / max(rEdge, 1e-4), 0.0, 1.0);',
    '  float nz = sqrt(max(0.0, 1.0 - rn * rn));',
    '  vec3 n = normalize(vec3(uv / max(rEdge, 1e-4), nz));',

    '  vec2 sp = uv / max(rEdge, 1e-4);',
    '  float curlAmp = 0.12 + u_energy * 0.07;',
    '  vec2 flow = curlFbm(sp * 0.95, t * 0.48);',
    '  sp += flow * curlAmp;',
    '  sp += curlFbm(sp * 1.7 + vec2(1.2, -0.6), t * 0.78) * (curlAmp * 0.50);',
    '  float spR = length(sp);',
    '  if (spR > 0.93) sp *= 0.93 / spR;',

    '  float wsum = 0.0;',
    '  vec3  cacc = vec3(0.0);',
    '  for (int i = 0; i < LOBES; i++) {',
    '    vec2  lp = u_lobes[i].xy;',
    '    float lr = max(u_lobes[i].z, 0.05);',
    '    float dd = length(sp - lp) / lr;',
    '    float w  = exp(-dd * dd * 2.65);',
    '    wsum += w;',
    '    cacc += lobeColor(u_lobes[i].w) * w;',
    '  }',
    '  vec3 fluid = cacc / max(wsum, 1e-4);',

    '  vec3 col = mix(u_c0, fluid, 0.72);',

    '  float lava = fbm(sp * 1.8 + flow * 0.40, t * 0.24);',
    '  lava = lava * 0.5 + 0.5;',
    '  float yBand = smoothstep(0.34, 0.46, lava) * (1.0 - smoothstep(0.50, 0.64, lava));',
    // 更宽的蓝带 + 第二层细蓝丝，让蓝色更梦幻可辨
    '  float bBand = smoothstep(0.48, 0.62, lava) * (1.0 - smoothstep(0.72, 0.92, lava));',
    '  float bSilk = fbm(sp * 3.2 - flow * 0.55, t * 0.38);',
    '  bSilk = smoothstep(0.42, 0.68, bSilk * 0.5 + 0.5);',
    '  col = mix(col, u_c1, yBand * 0.62);',
    '  col = mix(col, u_c2, bBand * 0.92 + bSilk * 0.38);',
    '  col = mix(col, u_c0, 0.08);',

    '  float core = 1.0 - smoothstep(0.0, 0.82, rn);',
    '  col *= 0.92 + 0.22 * core;',
    '  col = mix(col, mix(u_c1, u_c3, 0.55), 0.16 * core);',

    '  float fres = pow(1.0 - clamp(nz, 0.0, 1.0), 2.6);',
    '  fres *= 1.0 - smoothstep(0.84, 1.0, rn);',
    '  vec3 lightDir = normalize(vec3(-0.35, 0.55, 0.72));',
    '  float lambert = clamp(dot(n, lightDir) * 0.40 + 0.60, 0.0, 1.0);',
    '  col *= 0.96 + 0.14 * lambert;',

    // 边缘偏暖橙，侧边带一点蓝色散，偏梦幻
    '  float side = clamp(uv.x / max(rEdge, 1e-4), -1.0, 1.0);',
    '  vec3 rim = mix(u_c0, u_c2, 0.45 + 0.35 * side);',
    '  col = mix(col, rim, fres * 0.28);',
    '  float spec = pow(max(dot(n, lightDir), 0.0), 36.0);',
    '  col += mix(u_c1, u_c3, 0.4) * spec * 0.12;',
    '  col += mix(u_c0, u_c2, 0.25) * u_burst * 0.20;',

    '  float gt = max(0.0, d - rEdge) / (rEdge * 0.08);',
    '  float glow = exp(-9.0 * gt * gt) * (0.04 + 0.06 * prog + u_burst * 0.14);',
    '  vec3 glowCol = mix(mix(u_c0, u_c1, 0.25), u_c2, 0.18);',
    '  float alpha = clamp(mask + glow * 0.16, 0.0, 1.0);',
    '  vec3 outRgb = col * mask + glowCol * glow * 0.14;',
    '  outRgb /= max(alpha, 1e-4);',
    '  outRgb += (ign(gl_FragCoord.xy) - 0.5) / 255.0;',
    '  gl_FragColor = vec4(outRgb * alpha, alpha);',
    '}'
  ].join('\n');

  function compile(gl, type, src) {
    var sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      console.warn('[PikoOrb] shader compile failed:', gl.getShaderInfoLog(sh));
      gl.deleteShader(sh);
      return null;
    }
    return sh;
  }

  // 橙主 + 柔黄 + 梦幻蓝（偏亮青蓝，少灰紫）
  var DEFAULT_COLORS = [
    [1.00, 0.48, 0.12], // soft orange
    [1.00, 0.86, 0.42], // dreamy yellow
    [0.42, 0.68, 1.00], // luminous blue
    [1.00, 0.94, 0.82]  // soft highlight
  ];

  // 2 橙 + 1 黄 + 3 蓝 —— 橙仍是主底，蓝丝明显增多
  var LOBE_TONES = [0.0, 0.12, 0.48, 0.88, 1.0, 0.95];

  function LobeField() {
    this.lobes = [];
    for (var i = 0; i < LOBES; i++) {
      var a = (i / LOBES) * Math.PI * 2 + 0.35;
      var restR = 0.18 + (i % 3) * 0.09;
      this.lobes.push({
        x: Math.cos(a) * restR,
        y: Math.sin(a) * restR,
        vx: 0,
        vy: 0,
        restR: restR,
        radius: 0.46 + (i % 3) * 0.07,
        baseRadius: 0.46 + (i % 3) * 0.07,
        tone: LOBE_TONES[i],
        wf1: 0.15 + i * 0.039,
        wf2: 0.21 + i * 0.033,
        phase: a
      });
    }
  }

  LobeField.prototype.step = function (dt, time, energy) {
    var list = this.lobes;
    // 公转加快：色带明显绕球走
    var orbit = 1.05 + energy * 0.55;
    var stiffness = 2.8;
    var repel = 0.82;
    var damp = 1.45;
    var wander = 0.20 + energy * 0.14;

    for (var i = 0; i < LOBES; i++) {
      var L = list[i];
      var r = Math.sqrt(L.x * L.x + L.y * L.y) || 1e-4;

      var ax = -L.y / r * orbit;
      var ay = L.x / r * orbit;

      var pull = -(r - L.restR) * stiffness;
      ax += (L.x / r) * pull;
      ay += (L.y / r) * pull;

      for (var j = 0; j < LOBES; j++) {
        if (j === i) continue;
        var O = list[j];
        var dx = L.x - O.x;
        var dy = L.y - O.y;
        var dist = Math.sqrt(dx * dx + dy * dy) || 1e-4;
        var minD = (L.radius + O.radius) * 0.46;
        if (dist < minD) {
          var f = (minD - dist) / minD * repel;
          ax += (dx / dist) * f;
          ay += (dy / dist) * f;
        }
      }

      // soft-blob 游走：切向主导，带一点径向起伏
      var wobble = 0.70 + 0.30 * Math.sin(time * 0.41 + L.phase);
      var tangX = -L.y / r;
      var tangY = L.x / r;
      var radX = L.x / r;
      var radY = L.y / r;
      var tangAmp = Math.sin(time * L.wf1 * 6.283 + L.phase) * wander * wobble;
      var radAmp = Math.sin(time * L.wf2 * 6.283 + L.phase * 1.7) * wander * 0.34;
      ax += tangX * tangAmp + radX * radAmp;
      ay += tangY * tangAmp + radY * radAmp;
      ax += tangX * Math.sin(time * (L.wf2 * 0.71) + L.phase * 2.1) * wander * 0.30;
      ay += tangY * Math.cos(time * (L.wf1 * 0.63) + L.phase * 0.9) * wander * 0.30;

      L.vx = (L.vx + ax * dt) * Math.exp(-dt * damp);
      L.vy = (L.vy + ay * dt) * Math.exp(-dt * damp);
      L.x += L.vx * dt;
      L.y += L.vy * dt;

      var nr = Math.sqrt(L.x * L.x + L.y * L.y);
      if (nr > 0.62) {
        L.x = L.x / nr * 0.62;
        L.y = L.y / nr * 0.62;
        L.vx *= 0.42;
        L.vy *= 0.42;
      }

      L.radius = L.baseRadius * (1 + Math.sin(time * (0.90 + L.wf1) + L.phase) * (0.12 + energy * 0.14));
      // 色类锁定在橙/黄/蓝，只做极小抖动，避免漂成粉色
      L.tone = LOBE_TONES[i] + Math.sin(time * 0.25 + L.phase) * 0.03;
    }
  };

  LobeField.prototype.pack = function (out, spread) {
    for (var i = 0; i < LOBES; i++) {
      var L = this.lobes[i];
      out[i * 4] = L.x * spread;
      out[i * 4 + 1] = L.y * spread;
      out[i * 4 + 2] = L.radius;
      out[i * 4 + 3] = L.tone;
    }
    return out;
  };

  function springStep(state, target, dt, omega) {
    var accel = -2 * omega * state.v - omega * omega * (state.x - target);
    state.v += accel * dt;
    state.x += state.v * dt;
    return state.x;
  }

  function ema(prev, next, dt, tau) {
    return prev + (next - prev) * (1 - Math.exp(-dt / Math.max(0.001, tau)));
  }

  function PikoOrb(host) {
    this.host = host;
    this.canvas = null;
    this.gl = null;
    this.raf = null;
    this.t0 = 0;
    this._last = 0;
    this._accum = 0;
    this._cssW = 0;
    this._cssH = 0;
    this._boundFrame = null;
    this.progressSpring = { x: 0, v: 0 };
    this.targetProgress = 0;
    this.burst = 0;
    this.features = { energy: 0.45, bright: 0.5, rough: 0.35 };
    this.featSmooth = { energy: 0.45, bright: 0.5, rough: 0.35 };
    this.colors = DEFAULT_COLORS.map(function (c) { return c.slice(); });
    this.colorSmooth = DEFAULT_COLORS.map(function (c) { return c.slice(); });
    this.field = new LobeField();
    this.lobeBuf = new Float32Array(LOBES * 4);
    this.ok = false;
  }

  PikoOrb.prototype.init = function () {
    if (this.gl || !this.host) return this.ok;

    var canvas = document.createElement('canvas');
    canvas.className = 'magic-orb-canvas';
    canvas.setAttribute('aria-hidden', 'true');

    var gl = null;
    try {
      gl = canvas.getContext('webgl', {
        alpha: true,
        premultipliedAlpha: true,
        antialias: true,
        depth: false,
        stencil: false
      });
    } catch (err) {
      gl = null;
    }
    if (!gl) return false;

    var vs = compile(gl, gl.VERTEX_SHADER, VERT);
    var fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return false;

    var prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.warn('[PikoOrb] link failed:', gl.getProgramInfoLog(prog));
      return false;
    }
    gl.useProgram(prog);

    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(prog, 'a_pos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    this.u = {};
    ['u_res', 'u_time', 'u_progress', 'u_burst', 'u_energy', 'u_bright', 'u_rough',
     'u_breath', 'u_lobes', 'u_c0', 'u_c1', 'u_c2', 'u_c3'].forEach(function (name) {
      this.u[name] = gl.getUniformLocation(prog, name);
    }, this);

    this.host.appendChild(canvas);
    this.canvas = canvas;
    this.gl = gl;
    this.ok = true;
    this.host.classList.add('has-orb-canvas');
    return true;
  };

  PikoOrb.prototype.resize = function (force) {
    if (!this.gl) return;
    if (!force && this._cssW > 0 && this._cssH > 0) {
      var dpr0 = Math.min(window.devicePixelRatio || 1, 2);
      var w0 = Math.max(1, Math.round(this._cssW * dpr0));
      var h0 = Math.max(1, Math.round(this._cssH * dpr0));
      if (this.canvas.width === w0 && this.canvas.height === h0) return;
    }
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var rect = this.canvas.getBoundingClientRect();
    var cssW = rect.width || this.canvas.offsetWidth || 509;
    var cssH = rect.height || this.canvas.offsetHeight || 509;
    this._cssW = cssW;
    this._cssH = cssH;
    var w = Math.max(1, Math.round(cssW * dpr));
    var h = Math.max(1, Math.round(cssH * dpr));
    if (this.canvas.width === w && this.canvas.height === h) return;
    this.canvas.width = w;
    this.canvas.height = h;
    this.gl.viewport(0, 0, w, h);
  };

  PikoOrb.prototype.setSample = function (sample) {
    var f = (sample && sample.features) || {};
    this.features = {
      energy: clamp01(f.energy != null ? f.energy : 0.62),
      bright: clamp01(f.brightness != null ? f.brightness : 0.55),
      rough: clamp01(f.roughness != null ? f.roughness : 0.38)
    };
    // 三色流体配色固定：橙主 / 黄 / 蓝。样本 palette 不再改写球色（否则会漂成粉紫）
    this.colors = DEFAULT_COLORS.map(function (c) { return c.slice(); });
    this.colorSmooth = DEFAULT_COLORS.map(function (c) { return c.slice(); });
  };

  PikoOrb.prototype.setProgress = function (p) {
    this.targetProgress = clamp01(p);
  };

  PikoOrb.prototype.bloom = function () {
    this.burst = 1;
  };

  PikoOrb.prototype.start = function () {
    if (!this.ok && !this.init()) return false;
    if (this.raf != null) return true;
    this.t0 = performance.now();
    this._last = this.t0;
    this._accum = 0;
    this.resize(true);
    var self = this;
    var FIXED = 1 / 60;

    this._boundFrame = function frame(now) {
      var frameDt = Math.min(0.05, (now - self._last) / 1000);
      self._last = now;
      self._accum += frameDt;

      var steps = 0;
      while (self._accum >= FIXED && steps < 3) {
        springStep(self.progressSpring, self.targetProgress, FIXED, 2.2);
        self.burst *= Math.exp(-FIXED * 1.9);

        self.featSmooth.energy = ema(self.featSmooth.energy, self.features.energy, FIXED, 0.45);
        self.featSmooth.bright = ema(self.featSmooth.bright, self.features.bright, FIXED, 0.55);
        self.featSmooth.rough = ema(self.featSmooth.rough, self.features.rough, FIXED, 0.55);

        for (var i = 0; i < 4; i++) {
          for (var c = 0; c < 3; c++) {
            self.colorSmooth[i][c] = ema(self.colorSmooth[i][c], self.colors[i][c], FIXED, 0.55);
          }
        }

        var timeStep = (now - self.t0) / 1000;
        self.field.step(FIXED, timeStep, self.featSmooth.energy);
        self._accum -= FIXED;
        steps += 1;
      }
      if (self._accum > FIXED * 3) self._accum = 0;

      self.draw((now - self.t0) / 1000);
      self.raf = requestAnimationFrame(self._boundFrame);
    };
    this.raf = requestAnimationFrame(this._boundFrame);
    return true;
  };

  PikoOrb.prototype.stop = function () {
    if (this.raf != null) cancelAnimationFrame(this.raf);
    this.raf = null;
  };

  PikoOrb.prototype.reset = function () {
    this.progressSpring = { x: 0, v: 0 };
    this.targetProgress = 0;
    this.burst = 0;
  };

  PikoOrb.prototype.draw = function (time) {
    var gl = this.gl;
    if (!gl) return;
    this.resize(false);

    var breath = Math.sin(time * 1.85 + 0.4) * 0.70 + Math.sin(time * 1.02) * 0.40;
    var spread = 0.90 - 0.06 * this.progressSpring.x;
    this.field.pack(this.lobeBuf, spread);

    gl.uniform2f(this.u.u_res, this.canvas.width, this.canvas.height);
    gl.uniform1f(this.u.u_time, time);
    gl.uniform1f(this.u.u_progress, this.progressSpring.x);
    gl.uniform1f(this.u.u_burst, this.burst);
    gl.uniform1f(this.u.u_energy, this.featSmooth.energy);
    gl.uniform1f(this.u.u_bright, this.featSmooth.bright);
    gl.uniform1f(this.u.u_rough, this.featSmooth.rough);
    gl.uniform1f(this.u.u_breath, breath);
    gl.uniform4fv(this.u.u_lobes, this.lobeBuf);
    gl.uniform3fv(this.u.u_c0, this.colorSmooth[0]);
    gl.uniform3fv(this.u.u_c1, this.colorSmooth[1]);
    gl.uniform3fv(this.u.u_c2, this.colorSmooth[2]);
    gl.uniform3fv(this.u.u_c3, this.colorSmooth[3]);

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  function clamp01(v) {
    var n = Number(v);
    if (!isFinite(n)) return 0;
    return Math.min(1, Math.max(0, n));
  }

  window.PikoOrb = PikoOrb;
})();
