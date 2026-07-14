// Merge VisualMappingEngine base params with Python visualModifiers.
const VisualParamFusion = {
  pythonWeight: 0.6,

  setPythonWeight(w) {
    this.pythonWeight = FeatureSchema.clamp01(w, 0.6);
  },

  mergeAndClamp(baseVisualParams, pythonModifiers, pythonWeight) {
    const base = baseVisualParams || {};
    const mods = pythonModifiers || {};
    const w = FeatureSchema.clamp01(pythonWeight ?? this.pythonWeight, 0.6);

    const lerp = (a, b, t) => a + (b - a) * t;
    const c = FeatureSchema.clamp01;

    const motionSpeed = c(lerp(base.motionSpeed ?? 0.05, mods.motionIntensity ?? base.motionSpeed, w));
    const particleDensity = c(lerp(base.particleDensity ?? 0.05, mods.particleDensity ?? base.particleDensity, w));
    const brushSoftness = c(lerp(base.brushSoftness ?? 0.5, mods.smoothness ?? base.brushSoftness, w));
    const flowSmoothness = c(lerp(base.flowSmoothness ?? 0.5, mods.continuity ?? base.flowSmoothness, w));
    const shapeComplexity = c(lerp(base.shapeComplexity ?? 0.05, mods.strokeComplexity ?? base.shapeComplexity, w));
    const colorVariation = c(lerp(base.colorVariation ?? 0.05, mods.organicFactor ?? base.colorVariation, w));
    const growthBranching = c(lerp(base.growthBranching ?? 0.05, mods.spread ?? base.growthBranching, w));
    const directionChange = c(lerp(base.directionChange ?? 0.05, mods.turbulence ?? base.directionChange, w));

    return {
      ...base,
      motionSpeed,
      particleDensity,
      brushSoftness,
      flowSmoothness,
      shapeComplexity,
      colorVariation,
      growthBranching,
      directionChange,
      pythonFusion: {
        motionIntensity: mods.motionIntensity,
        turbulence: mods.turbulence,
        flowSpeed: mods.flowSpeed,
        pulseStrength: mods.pulseStrength,
        rotationSpeed: mods.rotationSpeed,
        scaleResponse: mods.scaleResponse,
        weight: w
      }
    };
  },

  buildPipeline(baseVisualParams, features, personality, aiResult, pythonModifiers) {
    const fused = this.mergeAndClamp(baseVisualParams, pythonModifiers);
    const brush = BrushSchema.fromVisualAndModifiers(fused, pythonModifiers, features);
    window.activeBrushParams = brush;
    return { visualParams: fused, brushParams: brush };
  }
};

window.VisualParamFusion = VisualParamFusion;
