// Unified brush schema — single exit for BrushGenerator / Creative Canvas.
const BrushSchema = {
  empty() {
    return {
      color: {},
      strokeWidth: 0,
      flow: 0,
      density: 0,
      turbulence: 0,
      motion: 0,
      continuity: 0,
      particleDensity: 0,
      rotationSpeed: 0,
      smoothness: 0,
      texture: {},
      styleModifiers: {}
    };
  },

  fromVisualAndModifiers(visualParams, modifiers, features) {
    const vp = visualParams || {};
    const m = modifiers || {};
    const f = FeatureSchema.normalizeFeatures(features);
    const c = FeatureSchema.clamp01;

    const palette = vp.palette || [];
    const color = palette.length ? palette[0] : { r: 120, g: 115, b: 110 };

    return {
      color,
      strokeWidth: c((m.scaleResponse ?? 0.3) * 0.6 + (f.volume ?? 0) * 0.4),
      flow: c((m.flowSpeed ?? vp.flowSmoothness ?? 0.3) * 0.7 + (vp.flowSmoothness ?? 0.3) * 0.3),
      density: c(m.particleDensity ?? vp.particleDensity ?? 0.2),
      turbulence: c(m.turbulence ?? vp.directionChange ?? 0.15),
      motion: c(m.motionIntensity ?? vp.motionSpeed ?? 0.1),
      continuity: c(m.continuity ?? vp.flowSmoothness ?? 0.5),
      particleDensity: c(m.particleDensity ?? vp.particleDensity ?? 0.2),
      rotationSpeed: c(m.rotationSpeed ?? 0.1),
      smoothness: c(m.smoothness ?? vp.brushSoftness ?? 0.5),
      texture: { pattern: vp.texturePattern || "flow" },
      strokePattern: vp.strokePattern || window.activeVisualStructure?.strokePattern || "flow_field",
      motionModel: vp.motionModel || window.activeVisualStructure?.motionModel || "drift_continuous",
      styleModifiers: {
        organicFactor: c(m.organicFactor),
        pulseStrength: c(m.pulseStrength),
        spread: c(m.spread),
        strokeComplexity: c(m.strokeComplexity),
        brightness: f.brightness,
        pitch: f.pitch
      }
    };
  },

  applyToVisualParams(visualParams, brushParams) {
    if (!brushParams) return visualParams;
    const vp = { ...visualParams };
    vp.motionSpeed = Math.max(vp.motionSpeed || 0, brushParams.motion || 0);
    vp.particleDensity = Math.max(vp.particleDensity || 0, brushParams.particleDensity || 0);
    vp.brushSoftness = brushParams.smoothness ?? vp.brushSoftness;
    vp.directionChange = Math.max(vp.directionChange || 0, brushParams.turbulence || 0);
    vp._brush = brushParams;
    return vp;
  }
};

window.BrushSchema = BrushSchema;
