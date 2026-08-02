// Owns the Visual Generation Area: animated sound forms + drawing canvas.
//
// Layout:
//   Top strip — living material previews (palette / brush / texture)
//   Main row — LEFT animated form | CENTER draw canvas
class CanvasInteraction {
  constructor(brushGenerator) {
    this.brushGenerator = brushGenerator;
    this.visualTransformation = new VisualTransformation();
    this.sphereHost = this._createSphereHost();
    this.leftField = new SoundMembraneSphere(this.sphereHost, {
      seed: 1,
      enableShapeMorph: true,
      shapeMorphStrength: 0.72
    });
    this.artLayer = createGraphics(width, height);
    this.artLayer.elt.style.display = "none";
    this.persistentLayer = createGraphics(width, height);
    this.persistentLayer.elt.style.display = "none";
    this.canvasTool = "draw";
    this._strokeActive = false;
    this.lastMouse = { x: 0, y: 0 };
    this._pressStartedOnUi = false;
    this._pointerOverUi = false;
    // Figma 1:298 白纸默认：Rectangle 136 @ (87,157) 880×623 rx30
    this.paperRest = { x: 87, y: 157, w: 880, h: 623 };
    this.paper = {
      x: 87,
      y: 157,
      scale: 1,
      w: 880,
      h: 623,
      minScale: 0.35,
      maxScale: 4.5
    };
    this._pointers = new Map();
    this._pinch = null;
    this._navActive = false;
    this._spaceDown = false;
    this._panDrag = null;
    this._installUiGuard();
    this._installPaperNav();
    this.clear();
  }

  // p5 的 mouseIsPressed / mouseX 是全局量：按在浮层 UI（画布顶栏等）上也会为真，
  // 全幅模式下整块画布都是绘制区，于是点按钮会在其下方留笔迹。
  // 这里记录指针是否落在 UI 上，绘制时据此跳过。
  _installUiGuard() {
    const isUi = (node) =>
      !!(node && node.closest && node.closest(".piko-canvas-chrome, .piko-ui-layer"));

    document.addEventListener("pointerdown", (e) => {
      this._pressStartedOnUi = isUi(e.target);
      this._pointerOverUi = this._pressStartedOnUi;
    }, true);

    document.addEventListener("pointermove", (e) => {
      this._pointerOverUi = isUi(e.target);
    }, true);

    const release = () => { this._pressStartedOnUi = false; };
    document.addEventListener("pointerup", release, true);
    document.addEventListener("pointercancel", release, true);
  }

  /** 指针压在 UI 上、或拖到 UI 上方时不落笔 */
  isPointerOnUi() {
    return this._pressStartedOnUi || this._pointerOverUi;
  }

  /** 双指 / 空格拖 / 中键拖 导航中：禁止落笔 */
  isNavigating() {
    return this._navActive || this._pointers.size >= 2 || !!this._panDrag;
  }

  // —— Procreate 式白纸：棕底只是桌面，transform 只动白纸 ——
  _installPaperNav() {
    const isUi = (node) =>
      !!(node && node.closest && node.closest(".piko-canvas-chrome, .piko-ui-layer"));

    const onDown = (e) => {
      if (!this.isPikoCanvasMode()) return;
      if (isUi(e.target)) return;

      this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      // 中键 / 空格+左键：桌面拖移白纸
      if (e.button === 1 || (e.button === 0 && this._spaceDown)) {
        e.preventDefault();
        this._beginNav();
        this._panDrag = {
          id: e.pointerId,
          last: this._clientToStage(e.clientX, e.clientY)
        };
        return;
      }

      if (this._pointers.size >= 2) {
        e.preventDefault();
        this._beginNav();
        this._strokeActive = false;
        this._pinch = this._pinchState();
      }
    };

    const onMove = (e) => {
      if (!this.isPikoCanvasMode()) return;
      if (!this._pointers.has(e.pointerId)) return;
      this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (this._panDrag && this._panDrag.id === e.pointerId) {
        e.preventDefault();
        const cur = this._clientToStage(e.clientX, e.clientY);
        this.paper.x += cur.x - this._panDrag.last.x;
        this.paper.y += cur.y - this._panDrag.last.y;
        this._panDrag.last = cur;
        this._clampPaper();
        this._applyPaperTransform();
        return;
      }

      if (this._pointers.size >= 2) {
        e.preventDefault();
        this._beginNav();
        const next = this._pinchState();
        if (this._pinch && next) {
          const factor = next.dist / Math.max(1e-3, this._pinch.dist);
          this._scaleAt(next.cx, next.cy, factor);
          this.paper.x += next.cx - this._pinch.cx;
          this.paper.y += next.cy - this._pinch.cy;
          this._clampPaper();
          this._applyPaperTransform();
          this._pinch = next;
        } else {
          this._pinch = next;
        }
      }
    };

    const onUp = (e) => {
      this._pointers.delete(e.pointerId);
      if (this._panDrag && this._panDrag.id === e.pointerId) {
        this._panDrag = null;
      }
      if (this._pointers.size < 2) this._pinch = null;
      if (this._pointers.size === 0 && !this._panDrag) {
        this._navActive = false;
      }
      if (this._pointers.size === 1) {
        // 双指收成单指：重新取 pinch 基准，避免跳变
        this._pinch = null;
      }
    };

    const onWheel = (e) => {
      if (!this.isPikoCanvasMode()) return;
      if (isUi(e.target)) return;
      e.preventDefault();
      const stage = this._clientToStage(e.clientX, e.clientY);
      const direction = e.deltaY < 0 ? 1 : -1;
      // 触控板/滚轮：平滑一点
      const factor = Math.exp(direction * Math.min(0.18, Math.abs(e.deltaY) * 0.0018));
      this._scaleAt(stage.x, stage.y, factor);
      this._clampPaper();
      this._applyPaperTransform();
    };

    const onKeyDown = (e) => {
      if (e.code === "Space" && this.isPikoCanvasMode()) {
        this._spaceDown = true;
        // 避免空格滚动页面 / 点到按钮
        if (e.target === document.body || e.target === document.documentElement ||
            (e.target && e.target.closest && e.target.closest("#analysisView"))) {
          e.preventDefault();
        }
      }
    };
    const onKeyUp = (e) => {
      if (e.code === "Space") {
        this._spaceDown = false;
        if (this._panDrag) this._panDrag = null;
      }
    };

    // 绑在 document 上：捏合时第二指常落在纸外棕底
    document.addEventListener("pointerdown", onDown, { capture: true, passive: false });
    document.addEventListener("pointermove", onMove, { capture: true, passive: false });
    document.addEventListener("pointerup", onUp, true);
    document.addEventListener("pointercancel", onUp, true);
    document.addEventListener("wheel", onWheel, { capture: true, passive: false });
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
  }

  _beginNav() {
    if (this._strokeActive) this.commitStroke();
    this._navActive = true;
  }

  _clientToStage(clientX, clientY) {
    const stage = document.getElementById("pikoStage");
    if (!stage) return { x: clientX, y: clientY };
    const rect = stage.getBoundingClientRect();
    const designW = 1055;
    const scale = rect.width / designW;
    return {
      x: (clientX - rect.left) / scale,
      y: (clientY - rect.top) / scale
    };
  }

  _pinchState() {
    if (this._pointers.size < 2) return null;
    const pts = Array.from(this._pointers.values());
    const a = this._clientToStage(pts[0].x, pts[0].y);
    const b = this._clientToStage(pts[1].x, pts[1].y);
    const cx = (a.x + b.x) * 0.5;
    const cy = (a.y + b.y) * 0.5;
    const dist = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return { cx, cy, dist };
  }

  _scaleAt(mx, my, factor) {
    const p = this.paper;
    const next = Math.min(p.maxScale, Math.max(p.minScale, p.scale * factor));
    const ratio = next / p.scale;
    // 保持 (mx,my) 下的纸面点不动
    p.x = mx - (mx - p.x) * ratio;
    p.y = my - (my - p.y) * ratio;
    p.scale = next;
  }

  _clampPaper() {
    const p = this.paper;
    const stageW = 1055;
    const stageH = 834;
    const deskTop = 130;
    const margin = 72;
    const pw = p.w * p.scale;
    const ph = p.h * p.scale;
    p.x = Math.min(stageW - margin, Math.max(margin - pw, p.x));
    p.y = Math.min(stageH - margin, Math.max(deskTop + margin - ph, p.y));
  }

  resetPaperTransform() {
    const rest = this.paperRest || { x: 87, y: 157, w: 880, h: 623 };
    this.paper.x = rest.x;
    this.paper.y = rest.y;
    this.paper.w = rest.w;
    this.paper.h = rest.h;
    this.paper.scale = 1;
    this._navActive = false;
    this._pinch = null;
    this._panDrag = null;
    this._pointers.clear();
    this._applyPaperTransform();
  }

  _applyPaperTransform() {
    const holder = document.getElementById("canvasHolder");
    if (!holder || !this.isPikoCanvasMode()) return;
    const rest = this.paperRest || { x: 87, y: 157 };
    const p = this.paper;
    // 默认位由 CSS 写死 Figma 坐标；JS 只叠加相对偏移，避免未跑 JS 时纸贴在 (0,0)
    holder.style.left = rest.x + "px";
    holder.style.top = rest.y + "px";
    holder.style.width = (p.w || rest.w || 880) + "px";
    holder.style.height = (p.h || rest.h || 623) + "px";
    holder.style.transformOrigin = "0 0";
    const dx = p.x - rest.x;
    const dy = p.y - rest.y;
    if (Math.abs(dx) < 0.05 && Math.abs(dy) < 0.05 && Math.abs(p.scale - 1) < 0.001) {
      holder.style.transform = "";
    } else {
      holder.style.transform = `translate(${dx}px, ${dy}px) scale(${p.scale})`;
    }
  }

  clearPaperTransformStyle() {
    const holder = document.getElementById("canvasHolder");
    if (!holder) return;
    holder.style.transform = "";
    holder.style.transformOrigin = "";
    holder.style.left = "";
    holder.style.top = "";
    holder.style.width = "";
    holder.style.height = "";
  }

  // DOM overlay that hosts the Three.js sphere directly over the left zone.
  _createSphereHost() {
    const holder = document.getElementById("canvasHolder");
    const host = document.createElement("div");
    host.id = "soundBreathingHost";
    host.style.position = "absolute";
    host.style.left = "0px";
    host.style.top = "0px";
    host.style.width = "1px";
    host.style.height = "1px";
    host.style.background = "#000000";
    host.style.overflow = "hidden";
    host.style.pointerEvents = "none";
    host.style.zIndex = "5";
    const label = document.createElement("span");
    label.textContent = "sound breathing";
    label.style.position = "absolute";
    label.style.top = "10px";
    label.style.left = "0";
    label.style.right = "0";
    label.style.textAlign = "center";
    label.style.fontSize = "10px";
    label.style.letterSpacing = "0.12em";
    label.style.textTransform = "uppercase";
    label.style.color = "rgba(190, 205, 220, 0.55)";
    label.style.pointerEvents = "none";
    label.style.zIndex = "6";
    host.appendChild(label);

    if (holder) {
      const cs = window.getComputedStyle(holder);
      // Piko 画板模式需要 absolute 贴 Figma 坐标，别写死 relative
      if (cs.position === "static" && !this.isPikoCanvasMode()) {
        holder.style.position = "relative";
      }
      holder.appendChild(host);
    }
    return host;
  }

  // Map p5 canvas-space zone to CSS pixels and position the host element.
  _positionSphereHost(zone) {
    const host = this.sphereHost;
    if (!host) return;
    const holder = document.getElementById("canvasHolder");
    const cw = (holder && holder.clientWidth) || width;
    const ch = (holder && holder.clientHeight) || height;
    const sx = cw / width;
    const sy = ch / height;
    host.style.left = Math.round(zone.x * sx) + "px";
    host.style.top = Math.round(zone.y * sy) + "px";
    host.style.width = Math.max(1, Math.round(zone.w * sx)) + "px";
    host.style.height = Math.max(1, Math.round(zone.h * sy)) + "px";
  }

  // Push analysed features when idle; live FFT is read inside SoundMembraneSphere.
  _feedSphereAudio() {
    if (!this.leftField || typeof this.leftField.updateAudioState !== "function") return;

    const app = window.App;
    if (app?.playbackAudio && !app.playbackAudio.paused) return;
    if (app?.transformView?.waveAnalyser && app.transformView.waveAudioCtx?.state === "running") return;

    const f = window.activeAudioFeatures;
    if (!f) return;

    if (this.leftField.applyAcousticViz && window.activeAcousticViz !== this._lastAcousticViz) {
      this.leftField.applyAcousticViz(window.activeAcousticViz || null, {
        playbackTimeProvider: () => window.App?.playbackAudio?.currentTime ?? null,
        enableShapeMorph: true,
        shapeMorphStrength: 0.72
      });
      this._lastAcousticViz = window.activeAcousticViz || null;
    }

    this.leftField.updateAudioState({
      bass: f.bass,
      lowMid: (f.mid ?? 0) * 0.88,
      mid: f.mid,
      treble: f.treble,
      level: f.volume ?? f.energy ?? 0,
      flux: f.spectralVariation ?? f.roughness ?? 0
    });
  }

  _feedSphereShape() {
    if (!this.leftField?.updateShapeProfile) return;

    const profile = window.activeShapeProfile;
    const archetype = window.activeNaturalArchetype;
    const version = window.activeShapeProfileVersion;

    if (!profile) {
      this.leftField.clearShapeProfile?.();
      this._lastShapeProfileVersion = null;
      return;
    }

    if (version && version === this._lastShapeProfileVersion) return;

    this.leftField.updateShapeProfile(profile, archetype, {
      enabled: true,
      strength: 0.82
    });

    this._lastShapeProfileVersion = version || JSON.stringify(profile);
  }

  resize() {
    const prev = this.artLayer;
    const prevPersist = this.persistentLayer;
    this.artLayer = createGraphics(width, height);
    this.artLayer.elt.style.display = "none";
    this.persistentLayer = createGraphics(width, height);
    this.persistentLayer.elt.style.display = "none";
    this.artLayer.image(prev, 0, 0, width, height);
    this.persistentLayer.image(prevPersist, 0, 0, width, height);
  }

  setCanvasTool(tool) {
    if (tool === "erase" && this._strokeActive) this.commitStroke();
    this.canvasTool = tool === "erase" ? "erase" : "draw";
    if (this.brushGenerator) this.brushGenerator.setTool(this.canvasTool);
  }

  commitStroke() {
    if (!this.brushGenerator || !this.artLayer || !this.persistentLayer) return;
    this.brushGenerator.commitLiveTo(this.persistentLayer, this.artLayer);
    this._strokeActive = false;
  }

  _centerClipRect(l) {
    const z = l.centerZone;
    return {
      x: z.x + 6,
      y: z.y + 6,
      w: Math.max(1, z.w - 12),
      h: Math.max(1, z.h - 12)
    };
  }

  _isInCenterZone(l, x, y) {
    const r = this._centerClipRect(l);
    return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  }

  drawPlateInk(l) {
    const r = this._centerClipRect(l);
    const ctx = drawingContext;
    ctx.save();
    ctx.beginPath();
    ctx.rect(r.x, r.y, r.w, r.h);
    ctx.clip();
    image(this.persistentLayer, 0, 0);
    if (this.canvasTool === "draw") {
      image(this.artLayer, 0, 0);
    }
    ctx.restore();
  }

  clear() {
    this.artLayer.clear();
    this.persistentLayer.clear();
    if (this.brushGenerator) this.brushGenerator.clear();
    if (this.leftField) this.leftField.clear();
    this._strokeActive = false;
    this._lastAcousticViz = null;
    this._lastShapeProfileVersion = null;
    this.leftField?.clearShapeProfile?.();
  }

  resetField() {
    this.artLayer.clear();
    this.persistentLayer.clear();
    if (this.brushGenerator) this.brushGenerator.clear();
    if (this.leftField) this.leftField.clear();
    this._strokeActive = false;
    this._lastAcousticViz = null;
    this._lastShapeProfileVersion = null;
    this.leftField?.clearShapeProfile?.();
  }

  layout() {
    // Figma P6：圆角白画板内作画（外层深褐底由 CSS 负责）
    if (this.isPikoCanvasMode()) {
      return {
        materialsTop: 0,
        materialsHeight: 0,
        creativeTop: 0,
        creativeH: height,
        leftZone:   { x: 0, y: 0, w: 0, h: 0 },
        centerZone: { x: 0, y: 0, w: width, h: height },
        pikoFull: true
      };
    }
    const materialsH = Math.max(72, Math.floor(height * 0.14));
    const creativeTop = materialsH + 4;
    const creativeH = Math.max(1, height - creativeTop - 8);
    const sideW = width * 0.28;
    const centerW = width - sideW;
    return {
      materialsTop: 0,
      materialsHeight: materialsH,
      creativeTop,
      creativeH,
      leftZone:   { x: 0, y: creativeTop, w: sideW, h: creativeH },
      centerZone: { x: sideW, y: creativeTop, w: centerW, h: creativeH }
    };
  }

  isPikoCanvasMode() {
    return !!document.getElementById("analysisView")?.classList.contains("piko-canvas-mode");
  }

  updateAndDraw(visualParameters, personalityVector, aiResult) {
    const l = this.layout();
    this.drawPaper();

    if (l.pikoFull) {
      // 圆角白画板内；藏左侧球体
      if (this.sphereHost) this.sphereHost.style.display = "none";
      this.drawCenterCanvas(l, visualParameters);
    } else {
      if (this.sphereHost) this.sphereHost.style.display = "";
      // The membrane sphere renders itself into its own DOM canvas (own RAF loop).
      // p5 only positions the host element over the left zone.
      this._positionSphereHost(l.leftZone);
      this._feedSphereAudio();
      this._feedSphereShape();
      if (this.leftField?.updatePalette) {
        this.leftField.updatePalette(visualParameters?.palette);
      }
      this.drawCenterCanvas(l, visualParameters);
      this.drawZoneHints(l);
    }

    if (mouseIsPressed && this.isMouseInside() && !this.isPointerOnUi() && !this.isNavigating()) {
      const inCenter = this._isInCenterZone(l, mouseX, mouseY);
      if (inCenter) {
        if (this.canvasTool === "erase") {
          this.brushGenerator.addEraseStroke(
            mouseX, mouseY,
            this.lastMouse.x, this.lastMouse.y
          );
        } else {
          this._strokeActive = true;
          this.brushGenerator.addStroke(
            mouseX, mouseY,
            this.lastMouse.x, this.lastMouse.y,
            visualParameters
          );
        }
      }
    }
    if (!this.isNavigating()) {
      this.lastMouse = { x: mouseX, y: mouseY };
    }

    this.brushGenerator.updateAudioFeatures(visualParameters, personalityVector, aiResult);
    if (this.canvasTool === "draw") {
      this.brushGenerator.updateAndDraw(
        this.artLayer, visualParameters, personalityVector, aiResult
      );
    }
    this.brushGenerator.updateEraseWaves(this.persistentLayer);

    this.drawPlateInk(l);

    if (!l.pikoFull) {
      this.drawVisualMaterials(visualParameters);
      this.drawZoneLabels(l);
    }
  }

  drawCenterCanvas(l, visualParameters) {
    const z = l.centerZone;
    noStroke();
    if (l.pikoFull) {
      // Figma：白画板内纯白底，圆角由 .canvas-holder 裁切
      fill(255, 255, 255);
      rect(0, 0, width, height);
      return;
    }
    fill(255, 255, 255, 235);
    rect(z.x + 6, z.y + 6, z.w - 12, z.h - 12, 6);

    const palette = (visualParameters && visualParameters.palette) || [];
    if (palette.length) {
      const c = palette[0];
      stroke(c.r, c.g, c.b, 40);
      strokeWeight(1.5);
      noFill();
      rect(z.x + 6, z.y + 6, z.w - 12, z.h - 12, 6);
    }
  }

  drawPaper() {
    if (this.isPikoCanvasMode()) {
      background(255, 255, 255);
      return;
    }
    background(248, 247, 244);
    noStroke();
    fill(250, 249, 246);
    rect(0, 0, width, height);
  }

  drawZoneHints(l) {
    const palette = window.activeVisualParams && window.activeVisualParams.palette;
    const accent = palette && palette.length
      ? palette[Math.floor(palette.length / 2)]
      : { r: 180, g: 170, b: 200 };

    stroke(accent.r, accent.g, accent.b, 60);
    strokeWeight(1);
    line(l.centerZone.x, l.creativeTop + 4, l.centerZone.x, height - 4);
  }

  drawZoneLabels(l) {
    noStroke();
    textStyle(NORMAL);
    textSize(10);

    const palette = window.activeVisualParams && window.activeVisualParams.palette;
    const labelColor = palette && palette.length
      ? color(palette[palette.length - 1].r, palette[palette.length - 1].g, palette[palette.length - 1].b, 160)
      : color(130, 125, 145, 150);

    fill(labelColor);
    textAlign(CENTER, TOP);
    text("sound breathing", l.leftZone.x + l.leftZone.w / 2, l.creativeTop + 10);

    fill(80, 75, 95, 200);
    textSize(11);
    let drawLabel;
    if (this.canvasTool === "erase") {
      drawLabel = window.App?.plateMode
        ? "气息擦除 — 螺旋呼气溶解笔迹"
        : "breath erase — dissolve with sound";
    } else {
      drawLabel = window.App?.plateMode
        ? "在共享画板上绘画 — 笔触会保留"
        : "draw with your sound — strokes persist";
    }
    text(drawLabel, l.centerZone.x + l.centerZone.w / 2, l.creativeTop + 10);
  }

  drawVisualMaterials(visualParameters) {
    const l = this.layout();
    const params = visualParameters || {};
    const outerPad = 10;
    const gap = 8;
    const cardW = (width - outerPad * 2 - gap * 2) / 3;
    const cardTop = l.materialsTop + 4;
    const cardH = l.materialsHeight - 8;

    const cards = [
      { label: "Color Palette", render: (x, y, w, h) => this.visualTransformation.drawPalette(params, x, y, w, h) },
      {
        label: "Your Brush",
        subtitle: (() => {
          const p = params.strokePattern || window.activeVisualStructure?.strokePattern;
          return p && window.NaturalSoundArchetypes?.patternLabels?.[p]?.zh;
        })(),
        render: (x, y, w, h) => this.visualTransformation.drawBrushPreview(params, x, y, w, h)
      },
      { label: "Texture", render: (x, y, w, h) => this.visualTransformation.drawTexturePreview(params, x, y, w, h) }
    ];

    cards.forEach((card, idx) => {
      const cx = outerPad + idx * (cardW + gap);
      const palette = params.palette || [{ r: 240, g: 238, b: 245 }];
      const accent = palette[Math.min(1, palette.length - 1)];

      noStroke();
      fill(252, 251, 249, 240);
      rect(cx, cardTop, cardW, cardH, 6);

      stroke(accent.r, accent.g, accent.b, 90);
      strokeWeight(1);
      noFill();
      rect(cx + 0.5, cardTop + 0.5, cardW - 1, cardH - 1, 6);

      noStroke();
      fill(accent.r * 0.35 + 40, accent.g * 0.35 + 40, accent.b * 0.35 + 50, 220);
      textSize(10);
      textStyle(BOLD);
      textAlign(LEFT, TOP);
      text(card.label, cx + 10, cardTop + 7);
      if (card.subtitle) {
        textStyle(NORMAL);
        textSize(9);
        fill(accent.r * 0.28 + 55, accent.g * 0.28 + 55, accent.b * 0.28 + 65, 190);
        text(card.subtitle, cx + 10, cardTop + 19);
      }

      const cX = cx + 8;
      const cY = cardTop + (card.subtitle ? 30 : 22);
      const cW = cardW - 16;
      const cH = cardH - 28;
      if (cW > 8 && cH > 8) card.render(cX, cY, cW, cH);
    });
  }

  isMouseInside() {
    return mouseX >= 0 && mouseX <= width && mouseY >= 0 && mouseY <= height;
  }

  /**
   * 导出当前白纸为 PNG Blob（白底 + 持久层 + 未提交笔迹）。
   * 供保存到 My Gallery 使用。
   */
  exportArtworkPng() {
    const w = Math.max(1, Math.round(this.paper?.w || width || 880));
    const h = Math.max(1, Math.round(this.paper?.h || height || 623));
    const out = document.createElement("canvas");
    out.width = w;
    out.height = h;
    const ctx = out.getContext("2d");
    if (!ctx) return Promise.resolve(null);

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);

    const drawLayer = (g) => {
      if (!g) return;
      const src = g.elt || g.canvas || g;
      if (!src || typeof src.width !== "number") return;
      try {
        ctx.drawImage(src, 0, 0, w, h);
      } catch (err) {
        console.warn("[CanvasInteraction] export layer failed:", err);
      }
    };

    // 若有未提交的 live 笔迹，先合进去再导出
    if (this._strokeActive && this.canvasTool === "draw") {
      try { this.commitStroke(); } catch (e) { /* noop */ }
    }

    drawLayer(this.persistentLayer);
    drawLayer(this.artLayer);

    return new Promise((resolve) => {
      if (out.toBlob) {
        out.toBlob((blob) => resolve(blob || null), "image/png");
      } else {
        resolve(null);
      }
    });
  }
}

window.CanvasInteraction = CanvasInteraction;
