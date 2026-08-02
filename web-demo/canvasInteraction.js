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
    this._installUiGuard();
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

    if (mouseIsPressed && this.isMouseInside() && !this.isPointerOnUi()) {
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
    this.lastMouse = { x: mouseX, y: mouseY };

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
}

window.CanvasInteraction = CanvasInteraction;
