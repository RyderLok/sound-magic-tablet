// Visual material previews — palette, brush, and texture from sound parameters.
class VisualTransformation {
  constructor() {
    this.paper = { r: 248, g: 247, b: 244 };
  }

  paletteFromParams(visualParameters) {
    if (visualParameters.palette && visualParameters.palette.length) {
      return visualParameters.palette.map((c) => color(c.r, c.g, c.b));
    }
    return [color(140, 120, 180), color(180, 140, 160), color(100, 130, 200)];
  }

  drawPalette(visualParameters, x, y, w, h) {
    const palette = this.paletteFromParams(visualParameters);
    const swatchWidth = w / palette.length;

    push();
    noStroke();
    for (let i = 0; i < palette.length; i += 1) {
      fill(palette[i]);
      rect(x + i * swatchWidth, y, swatchWidth + 0.5, h);
    }

    const grains = Math.floor(w * h * 0.035);
    for (let n = 0; n < grains; n += 1) {
      const gx = x + noise(n * 0.13, 1.1) * w;
      const gy = y + noise(n * 0.13, 4.7) * h;
      const c = visualParameters.palette
        ? visualParameters.palette[Math.floor(noise(n) * visualParameters.palette.length)]
        : { r: 60, g: 60, b: 80 };
      fill(c.r, c.g, c.b, 35);
      circle(gx, gy, 1);
    }

    noFill();
    stroke(255, 255, 255, 120);
    strokeWeight(1);
    rect(x + 0.5, y + 0.5, w - 1, h - 1);
    pop();
  }

  drawBrushPreview(visualParameters, x, y, w, h) {
    const pattern = visualParameters.strokePattern
      || window.activeVisualStructure?.strokePattern
      || "flow_field";
    const energy = this.clamp01(visualParameters.motionSpeed);
    const palette = visualParameters.palette || [{ r: 120, g: 115, b: 110 }];
    const ink = palette[Math.floor(palette.length * 0.4)] || palette[0];
    const cx = x + w * 0.5;
    const cy = y + h * 0.52;
    const phase = frameCount * (0.014 + energy * 0.02);

    push();
    drawingContext.save();
    drawingContext.beginPath();
    drawingContext.rect(x, y, w, h);
    drawingContext.clip();

    switch (pattern) {
      case "scatter_points":
        this._previewScatter(cx, cy, w, h, ink, energy, phase);
        break;
      case "wave_ripple":
        this._previewWave(cx, cy, w, h, ink, energy, phase);
        break;
      case "impact_burst":
        this._previewImpact(cx, cy, w, h, ink, energy, phase);
        break;
      case "pulse_grid":
        this._previewPulse(cx, cy, w, h, ink, energy, phase);
        break;
      default:
        this._previewFlow(cx, cy, w, h, ink, energy, phase);
    }

    drawingContext.restore();
    pop();
  }

  _previewFlow(cx, cy, w, h, ink, energy, phase) {
    const radius = Math.min(w, h) * lerp(0.18, 0.32, energy);
    const grains = Math.floor(lerp(90, 160, energy));
    strokeWeight(1);
    stroke(ink.r, ink.g, ink.b, 18);
    for (let i = 0; i < grains; i += 1) {
      const a = (i / grains) * TWO_PI + phase * 0.4;
      const rr = Math.abs(randomGaussian(0, radius * 0.42));
      const wobble = (noise(i * 0.08, phase) - 0.5) * radius * 0.12;
      point(cx + Math.cos(a + wobble * 0.02) * rr, cy + Math.sin(a + wobble * 0.02) * rr);
    }
  }

  _previewScatter(cx, cy, w, h, ink, energy, phase) {
    const spread = Math.min(w, h) * 0.38;
    strokeWeight(1.4);
    stroke(ink.r, ink.g, ink.b, 32);
    for (let i = 0; i < 18; i += 1) {
      const hop = (Math.sin(phase + i * 1.7) * 0.5 + 0.5) * spread;
      const a = (i / 18) * TWO_PI * 2 + phase * 0.2;
      point(cx + Math.cos(a) * hop, cy + Math.sin(a) * hop);
    }
  }

  _previewWave(cx, cy, w, h, ink, energy, phase) {
    const amp = Math.min(w, h) * lerp(0.08, 0.16, energy);
    noFill();
    stroke(ink.r, ink.g, ink.b, 55);
    strokeWeight(lerp(1, 2, energy));
    beginShape();
    for (let t = 0; t <= 1.001; t += 0.05) {
      const px = cx - w * 0.35 + t * w * 0.7;
      const py = cy + Math.sin(t * Math.PI * 3 + phase) * amp;
      curveVertex(px, py);
    }
    endShape();
    stroke(ink.r, ink.g, ink.b, 16);
    strokeWeight(1);
    for (let i = 0; i < 40; i += 1) {
      const t = i / 40;
      point(
        cx - w * 0.35 + t * w * 0.7,
        cy + Math.sin(t * Math.PI * 3 + phase) * amp + randomGaussian(0, 2)
      );
    }
  }

  _previewImpact(cx, cy, w, h, ink, energy, phase) {
    const r = Math.min(w, h) * lerp(0.12, 0.28, energy);
    noFill();
    stroke(ink.r, ink.g, ink.b, 90);
    strokeWeight(1.5);
    circle(cx, cy, r * (0.6 + Math.sin(phase * 3) * 0.15));
    stroke(ink.r, ink.g, ink.b, 28);
    strokeWeight(1);
    for (let i = 0; i < 55; i += 1) {
      const a = (i / 55) * TWO_PI + phase * 0.5;
      const rr = r * (0.2 + Math.random() * 0.75);
      point(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    }
  }

  _previewPulse(cx, cy, w, h, ink, energy, phase) {
    const rows = 5;
    const cols = 7;
    strokeWeight(1);
    stroke(ink.r, ink.g, ink.b, 22);
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const px = cx - w * 0.32 + (col / (cols - 1)) * w * 0.64;
        const py = cy - h * 0.22 + (row / (rows - 1)) * h * 0.44;
        const vib = Math.sin(phase * 2 + col * 0.8 + row * 0.5) * 3;
        point(px + vib, py);
      }
    }
  }

  drawTexturePreview(visualParameters, x, y, w, h) {
    const energy = this.clamp01(visualParameters.motionSpeed);
    const softness = this.clamp01(visualParameters.brushSoftness);
    const smoothness = this.clamp01(visualParameters.flowSmoothness);
    const playful = this.clamp01(visualParameters.shapeComplexity);
    const variation = this.clamp01(visualParameters.colorVariation);
    const directionChange = this.clamp01(visualParameters.directionChange);
    const branching = this.clamp01(visualParameters.growthBranching);
    const density = this.clamp01(visualParameters.particleDensity);
    const palette = visualParameters.palette || [{ r: 100, g: 120, b: 180 }];
    const pattern = visualParameters.texturePattern || "flow";

    const calm = this.clamp01(smoothness * (1 - energy * 0.5) * (0.5 + softness * 0.5));
    const flow = frameCount * 0.012;
    const tone = palette[Math.floor(palette.length / 2)];

    push();
    drawingContext.save();
    drawingContext.beginPath();
    drawingContext.rect(x, y, w, h);
    drawingContext.clip();

    if (pattern === "mist" || pattern === "flow") {
      const lines = Math.floor(lerp(4, 12, calm + energy * 0.2));
      noFill();
      for (let l = 0; l < lines; l += 1) {
        const c = palette[l % palette.length];
        stroke(c.r, c.g, c.b, 55);
        strokeWeight(lerp(1, 2.5, softness));
        const baseY = y + (l + 0.5) * (h / lines);
        beginShape();
        for (let sx = 0; sx <= 14; sx += 1) {
          const t = sx / 14;
          const px = x + t * w;
          const py = baseY + (noise(l * 0.6, t * 1.4, flow) - 0.5) * (h / lines) * lerp(0.35, 1.6, 1 - calm);
          curveVertex(px, py);
        }
        endShape();
      }
    }

    if (pattern === "grain" || pattern === "scatter" || pattern === "ripple") {
      const dots = Math.floor(lerp(25, 180, energy * 0.5 + playful * 0.3 + density * 0.4));
      noStroke();
      for (let d = 0; d < dots; d += 1) {
        const c = palette[d % palette.length];
        const px = x + noise(d * 0.19, flow * 0.4) * w;
        const py = y + noise(d * 0.19 + 50, flow * 0.4) * h;
        fill(c.r, c.g, c.b, lerp(50, 140, playful));
        const size = lerp(0.9, 3.6, energy);
        if (pattern === "ripple" && d % 5 === 0) {
          noFill();
          stroke(c.r, c.g, c.b, 70);
          circle(px, py, size * 3);
          noStroke();
        } else if (playful > 0.5 && d % 4 === 0) {
          rect(px, py, size, size);
        } else {
          circle(px, py, size);
        }
      }
    }

    const branches = Math.floor(lerp(0, 14, this.clamp01(branching * 0.6 + directionChange * 0.4)));
    stroke(tone.r, tone.g, tone.b, 85);
    strokeWeight(lerp(0.5, 1.5, variation));
    for (let b = 0; b < branches; b += 1) {
      const c = palette[b % palette.length];
      stroke(c.r, c.g, c.b, 80);
      let px = x + noise(b * 0.4 + 8) * w;
      let py = y + noise(b * 0.4 + 18) * h;
      let angle = noise(b * 0.4 + 28, flow) * Math.PI * 2;
      for (let s = 0; s < 5; s += 1) {
        const len = lerp(4, 14, energy);
        const nx = px + Math.cos(angle) * len;
        const ny = py + Math.sin(angle) * len;
        line(px, py, nx, ny);
        px = nx;
        py = ny;
        angle += (noise(b, s, flow) - 0.5) * Math.PI * (0.45 + directionChange);
      }
    }

    drawingContext.restore();
    pop();
  }

  clamp01(value) {
    return Math.min(1, Math.max(0, value || 0));
  }
}

window.VisualTransformation = VisualTransformation;
