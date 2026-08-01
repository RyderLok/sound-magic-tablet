/**
 * Piko Transform Orb — 声音凝结成笔刷材质的加载球
 *
 * 为什么是「soft-blob 物理 + shader」而不是纯 shader：
 *   纯噪声着色的球，颜色主轴来自固定光照方向，是静态的；噪声只能当细微扰动，
 *   实测稳态 1.5s 内像素只变化约 10/255，肉眼就是一张静止渐变图。
 *   所以把颜色的主导权交给 JS 侧一组「会动的色团」（lobe），
 *   shader 负责把它们以 metaball 方式融合并打上球体光照。
 *
 * 色团物理（借 Charlotte Dann soft-blob 的思路）：
 *   · 压力      —— 每个色团有目标半径，偏离就回弹
 *   · 斥力      —— 色团互相推开，形成「分离→靠近→融合」的循环
 *   · 张力弹簧  —— 拉回各自的静止轨道半径，不会飞出球外
 *   · 轨道漂移  —— 整簇缓慢公转
 *   · 无理数频率的正弦游走 —— 永不精确重复，避免看出周期
 *
 * shader 侧：
 *   · metaball 加权融合色团颜色（指数权重，天然平滑）
 *   · curl noise 只用来扰动采样点，让色团边界是流体状而非规则圆
 *   · 光照退化为亮度调制，不再抢夺颜色主导权
 *   · Interleaved Gradient Noise 抖动（Jorge Jimenez）抗色带
 */
(function () {
  'use strict';

  var LOBES = 5;

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
    // 每个色团：xy=位置(球半径归一化) z=半径 w=在色带上的取色位置
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
    '  return mix(mix(mix(dot(hash3(i + vec3(0,0,0)), f - vec3(0,0,0)),',
    '                     dot(hash3(i + vec3(1,0,0)), f - vec3(1,0,0)), u.x),',
    '                 mix(dot(hash3(i + vec3(0,1,0)), f - vec3(0,1,0)),',
    '                     dot(hash3(i + vec3(1,1,0)), f - vec3(1,1,0)), u.x), u.y),',
    '             mix(mix(dot(hash3(i + vec3(0,0,1)), f - vec3(0,0,1)),',
    '                     dot(hash3(i + vec3(1,0,1)), f - vec3(1,0,1)), u.x),',
    '                 mix(dot(hash3(i + vec3(0,1,1)), f - vec3(0,1,1)),',
    '                     dot(hash3(i + vec3(1,1,1)), f - vec3(1,1,1)), u.x), u.y), u.z);',
    '}',

    'float potential(vec2 p, float t) {',
    '  return gnoise(vec3(p * 0.9, t * 0.13));',
    '}',

    // 2D curl：v = (∂ψ/∂y, -∂ψ/∂x)，无散度，扰动才像被液体带着走
    'vec2 curl2(vec2 p, float t) {',
    '  float e = 0.015;',
    '  float dx = (potential(p + vec2(e, 0.0), t) - potential(p - vec2(e, 0.0), t)) / (2.0 * e);',
    '  float dy = (potential(p + vec2(0.0, e), t) - potential(p - vec2(0.0, e), t)) / (2.0 * e);',
    '  return vec2(dy, -dx);',
    '}',

    // 色带取色：0 → c0，1 → c3
    'vec3 ramp(float t) {',
    '  t = clamp(t, 0.0, 1.0);',
    '  vec3 c = mix(u_c0, u_c1, smoothstep(0.00, 0.36, t));',
    '  c = mix(c, u_c2, smoothstep(0.30, 0.68, t));',
    '  c = mix(c, u_c3, smoothstep(0.62, 1.00, t));',
    '  return c;',
    '}',

    'float ign(vec2 p) {',
    '  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));',
    '}',

    'void main() {',
    '  vec2 uv = (gl_FragCoord.xy - 0.5 * u_res) / min(u_res.x, u_res.y);',
    '  float t = u_time;',
    '  float prog = clamp(u_progress, 0.0, 1.0);',

    '  float breath = u_breath * 0.008;',
    '  float radius = mix(0.235, 0.298, prog) + u_burst * 0.024 + breath;',

    // 轮廓几乎不动：球外形稳，流动只在内部色带
    '  float edgeAmp = (0.010 + u_energy * 0.008 + u_rough * 0.006) * (1.0 - 0.60 * prog);',
    '  float rEdge = radius * (1.0 + gnoise(vec3(uv * 1.2, t * 0.08)) * edgeAmp);',

    '  float d = length(uv);',
    // 很窄的羽化：球缘清楚，颜色不会渗成粉雾
    '  float softIn  = mix(0.070, 0.038, prog);',
    '  float softOut = mix(0.055, 0.032, prog);',
    '  float mask = 1.0 - smoothstep(rEdge - softIn, rEdge + softOut, d);',
    '  if (mask <= 0.001) { gl_FragColor = vec4(0.0); return; }',

    '  float rn = clamp(d / max(rEdge, 1e-4), 0.0, 1.0);',
    '  float nz = sqrt(max(0.0, 1.0 - rn * rn));',
    '  vec3 n = normalize(vec3(uv / max(rEdge, 1e-4), nz));',

    // curl 微扰：只搅动色带交界，不把采样点拖出球面
    '  vec2 sp = uv / max(rEdge, 1e-4);',
    '  float curlAmp = 0.040 + u_energy * 0.028;',
    '  sp += curl2(sp * 1.20, t * 0.70) * curlAmp;',
    '  sp += curl2(sp * 2.10, t * 1.10) * (curlAmp * 0.22);',
    '  float spR = length(sp);',
    '  if (spR > 0.88) sp *= 0.88 / spR;',

    // —— metaball 融合：颜色由会动的色团决定 ——
    '  float wsum = 0.0;',
    '  vec3  cacc = vec3(0.0);',
    '  for (int i = 0; i < LOBES; i++) {',
    '    vec2  lp = u_lobes[i].xy;',
    '    float lr = max(u_lobes[i].z, 0.05);',
    '    float dd = length(sp - lp) / lr;',
    '    float w  = exp(-dd * dd * 2.55);',
    '    wsum += w;',
    '    cacc += ramp(u_lobes[i].w) * w;',
    '  }',
    '  vec3 col = cacc / max(wsum, 1e-4);',

    '  col = mix(ramp(0.5 + (u_bright - 0.5) * 0.3), col, clamp(wsum * 2.4, 0.0, 1.0));',

    // 球心色满，越近边缘越收进球体，杜绝彩色外渗
    '  float body = smoothstep(0.0, 0.18, mask) * (1.0 - smoothstep(0.82, 1.0, rn) * 0.22);',
    '  col *= 0.90 + 0.10 * body;',

    // 菲涅尔贴边、强度低
    '  float fres = pow(1.0 - clamp(nz, 0.0, 1.0), 2.6);',
    '  float rimFade = 1.0 - smoothstep(0.78, 1.0, rn);',
    '  fres *= rimFade * rimFade;',

    '  float la = t * 0.09;',
    '  vec3 lightDir = normalize(vec3(-0.42 + cos(la) * 0.16, 0.58, 0.65 + sin(la) * 0.10));',
    '  float lambert = clamp(dot(n, lightDir) * 0.5 + 0.5, 0.0, 1.0);',
    // 底亮抬高，橙色才透得出来
    '  col *= 0.98 + 0.38 * lambert;',
    '  col *= 1.08 + 0.10 * u_bright;',

    '  vec3 film = mix(u_c0, u_c3, 0.5 + 0.5 * sin(fres * 3.6 + t * 0.28));',
    '  col = mix(col, film, fres * 0.08);',

    // 早期几乎不再压灰，饱和度留住
    '  float grey = dot(col, vec3(0.299, 0.587, 0.114));',
    '  col = mix(vec3(grey), col, 0.90 + 0.10 * prog);',

    '  float spec = pow(max(dot(n, lightDir), 0.0), 20.0);',
    '  col += vec3(1.0, 0.96, 0.88) * spec * (0.18 + 0.20 * u_bright);',
    '  col += mix(u_c3, vec3(1.0), 0.55) * fres * (0.06 + 0.10 * prog);',
    '  col += vec3(1.0, 0.85, 0.55) * u_burst * (0.22 + fres * 0.26);',

    // 外晕：窄、淡、近白 —— 只勾轮廓，不拖彩色雾
    '  float gt = max(0.0, d - rEdge) / (rEdge * 0.14);',
    '  float glow = exp(-6.5 * gt * gt) * (0.06 + 0.08 * prog + u_burst * 0.18);',
    '  vec3 glowCol = mix(vec3(1.0), col, 0.18);',
    '  float alpha = clamp(mask + glow * 0.22, 0.0, 1.0);',
    '  vec3 outRgb = col * mask + glowCol * glow * 0.22;',
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

  // 默认跟品牌橙 #f16e1c 走：亮橙 + 暖杏 + 浅金，避免偏蓝紫发暗
  var DEFAULT_COLORS = [
    [1.00, 0.72, 0.38],
    [0.98, 0.48, 0.12],
    [1.00, 0.58, 0.22],
    [1.00, 0.88, 0.62]
  ];

  /**
   * 球内色团系统。
   * 压力 + 斥力 + 张力弹簧会收敛到平衡；单靠它们球会「静止」，
   * 所以额外叠一层公转和无理数频率的游走，让平衡永远差一点点。
   */
  function LobeField() {
    this.lobes = [];
    for (var i = 0; i < LOBES; i++) {
      var a = (i / LOBES) * Math.PI * 2;
      // 轨道更靠里：色带贴球面中带转，不顶到轮廓外
      var restR = 0.22 + (i % 2) * 0.10;
      this.lobes.push({
        x: Math.cos(a) * restR,
        y: Math.sin(a) * restR,
        vx: 0,
        vy: 0,
        restR: restR,
        // 色团略大：在球内铺成色带，而不是几团飘着的斑点
        radius: 0.52 + (i % 3) * 0.06,
        baseRadius: 0.52 + (i % 3) * 0.06,
        tone: i / (LOBES - 1),
        // 无理数比例的频率，保证整簇运动不会周期性重复
        wf1: 0.17 + i * 0.041,
        wf2: 0.23 + i * 0.037,
        phase: a
      });
    }
  }

  LobeField.prototype.step = function (dt, time, energy) {
    var list = this.lobes;
    // 公转主导「在球上流动」；径向游走压低，避免色团往外飘
    var orbit = 0.78 + energy * 0.42;
    var stiffness = 3.2;
    var repel = 0.70;
    var damp = 1.65;
    var wander = 0.14 + energy * 0.10;

    for (var i = 0; i < LOBES; i++) {
      var L = list[i];
      var r = Math.sqrt(L.x * L.x + L.y * L.y) || 1e-4;

      // 公转：切向力 —— 颜色绕球表面走
      var ax = -L.y / r * orbit;
      var ay = L.x / r * orbit;

      // 张力弹簧：牢牢拉回静止轨道
      var pull = -(r - L.restR) * stiffness;
      ax += (L.x / r) * pull;
      ay += (L.y / r) * pull;

      // 斥力：靠太近就推开，形成分离与融合的循环
      for (var j = 0; j < LOBES; j++) {
        if (j === i) continue;
        var O = list[j];
        var dx = L.x - O.x;
        var dy = L.y - O.y;
        var dist = Math.sqrt(dx * dx + dy * dy) || 1e-4;
        var minD = (L.radius + O.radius) * 0.48;
        if (dist < minD) {
          var f = (minD - dist) / minD * repel;
          ax += (dx / dist) * f;
          ay += (dy / dist) * f;
        }
      }

      // 游走：以切向为主，径向只留一点点起伏
      var wobble = 0.72 + 0.28 * Math.sin(time * 0.37 + L.phase);
      var tangX = -L.y / r;
      var tangY = L.x / r;
      var radX = L.x / r;
      var radY = L.y / r;
      var tangAmp = Math.sin(time * L.wf1 * 6.283 + L.phase) * wander * wobble;
      var radAmp = Math.sin(time * L.wf2 * 6.283 + L.phase * 1.7) * wander * 0.28;
      ax += tangX * tangAmp + radX * radAmp;
      ay += tangY * tangAmp + radY * radAmp;
      ax += tangX * Math.sin(time * (L.wf2 * 0.61) + L.phase * 2.1) * wander * 0.22;
      ay += tangY * Math.cos(time * (L.wf1 * 0.53) + L.phase * 0.9) * wander * 0.22;

      L.vx = (L.vx + ax * dt) * Math.exp(-dt * damp);
      L.vy = (L.vy + ay * dt) * Math.exp(-dt * damp);
      L.x += L.vx * dt;
      L.y += L.vy * dt;

      // 硬边界：色团中心锁在球内中带
      var nr = Math.sqrt(L.x * L.x + L.y * L.y);
      if (nr > 0.58) {
        L.x = L.x / nr * 0.58;
        L.y = L.y / nr * 0.58;
        L.vx *= 0.45;
        L.vy *= 0.45;
      }

      // 压力：半径轻呼吸，铺色仍连续
      L.radius = L.baseRadius * (1 + Math.sin(time * (0.85 + L.wf1) + L.phase) * (0.10 + energy * 0.12));
    }
  };

  /** 写进 Float32Array(LOBES*4)，直接喂 uniform4fv */
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
    this.colors = DEFAULT_COLORS.slice();
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
    // 每帧 getBoundingClientRect 会触发 layout，约 2s 后偶发 GC/回流叠在一起就像卡帧
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
      energy: clamp01(f.energy != null ? f.energy : 0.45),
      bright: clamp01(f.brightness != null ? f.brightness : 0.5),
      rough: clamp01(f.roughness != null ? f.roughness : 0.35)
    };

    var pal = sample && sample.visualParams && sample.visualParams.palette;
    if (!pal || !pal.length) {
      this.colors = DEFAULT_COLORS.slice();
      return;
    }

    // 同色系会塌；绕色相拉开，但整体偏暖、偏亮，贴品牌橙
    var base = rgbToHsl(pal[0]);
    // 若样本色太冷/太暗，把色相拉回暖橙再提亮
    var warmH = base.h;
    if (warmH > 50 && warmH < 320) warmH = 28 + (warmH % 17) * 0.4;
    var sat = Math.max(0.62, Math.min(0.95, base.s + 0.12));
    var offsets = [-18, 0, 14, 32];
    var lights = [0.78, 0.62, 0.70, 0.88];
    var sats = [sat * 0.78, sat, sat * 0.92, sat * 0.55];

    this.colors = offsets.map(function (deg, i) {
      return hslToRgb01(warmH + deg, sats[i], lights[i]);
    });
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

    // 复用同一回调，避免每帧新建闭包推高 GC（也是「跑一阵突然顿一下」的常见原因）
    this._boundFrame = function frame(now) {
      var frameDt = Math.min(0.05, (now - self._last) / 1000);
      self._last = now;
      self._accum += frameDt;

      // 固定物理步长：偶发卡顿时不会一次猛推，观感更稳
      var steps = 0;
      while (self._accum >= FIXED && steps < 3) {
        springStep(self.progressSpring, self.targetProgress, FIXED, 2.6);
        self.burst *= Math.exp(-FIXED * 2.2);

        self.featSmooth.energy = ema(self.featSmooth.energy, self.features.energy, FIXED, 0.45);
        self.featSmooth.bright = ema(self.featSmooth.bright, self.features.bright, FIXED, 0.55);
        self.featSmooth.rough = ema(self.featSmooth.rough, self.features.rough, FIXED, 0.55);

        for (var i = 0; i < 4; i++) {
          for (var c = 0; c < 3; c++) {
            self.colorSmooth[i][c] = ema(self.colorSmooth[i][c], self.colors[i][c], FIXED, 0.7);
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

    var breath = Math.sin(time * 1.95 + 0.4) * 0.70 + Math.sin(time * 1.07) * 0.40;
    // 色团铺在球内：spread < 1，颜色贴面流动而不是散出轮廓
    var spread = 0.88 - 0.08 * this.progressSpring.x;
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

  function rgbToHsl(rgb) {
    var r = (rgb.r || 0) / 255, g = (rgb.g || 0) / 255, b = (rgb.b || 0) / 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var l = (max + min) / 2;
    var d = max - min;
    if (d === 0) return { h: 30, s: 0, l: l };
    var s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    var h;
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return { h: h * 60, s: s, l: l };
  }

  function hslToRgb01(h, s, l) {
    h = ((h % 360) + 360) % 360 / 360;
    s = Math.min(1, Math.max(0, s));
    l = Math.min(1, Math.max(0, l));
    if (s === 0) return [l, l, l];
    var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    var p = 2 * l - q;
    return [hue2rgb(p, q, h + 1 / 3), hue2rgb(p, q, h), hue2rgb(p, q, h - 1 / 3)];
  }

  function hue2rgb(p, q, t) {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  }

  window.PikoOrb = PikoOrb;
})();
