// Natural sound archetypes — design §3: sound features → visual structure → brush assist.
const NaturalSoundArchetypes = {
  labels: {
    birds: { zh: "鸟类", en: "Birds" },
    wind_leaves: { zh: "风与树叶", en: "Wind & Leaves" },
    water: { zh: "水", en: "Water" },
    material_impact: { zh: "自然材质交互", en: "Material Impact" },
    insects_amphibians: { zh: "昆虫与两栖动物", en: "Insects & Amphibians" }
  },

  patternLabels: {
    scatter_points: { zh: "点彩跳跃", en: "Scatter Points" },
    flow_field: { zh: "流场雾纹", en: "Flow Field" },
    wave_ripple: { zh: "涟漪波浪", en: "Wave Ripple" },
    impact_burst: { zh: "冲击爆发", en: "Impact Burst" },
    pulse_grid: { zh: "脉冲栅格", en: "Pulse Grid" }
  },

  biasToArchetype: {
    bright_warm: "birds",
    cool_muted: "wind_leaves",
    cool_blue_green: "water",
    earth_contrast: "material_impact",
    mid_high_buzz: "insects_amphibians"
  },

  resolveArchetypeId(vs, exportData) {
    return vs?.archetypeId
      || exportData?.naturalArchetype?.id
      || this.biasToArchetype[vs?.paletteBias]
      || null;
  },

  buildSignaturePalette(features, archetypeId) {
    if (typeof SoundColorEngine !== "undefined") {
      return SoundColorEngine.buildFromFeatures(features, archetypeId);
    }
    return [{ r: 180, g: 120, b: 90 }];
  },

  stampVisualParams(vs, archetypeId, palette, pyData) {
    const mods = vs?.modifiers || {};
    if (typeof VisualParamFusion !== "undefined" && window.activeVisualParams) {
      window.activeVisualParams = VisualParamFusion.mergeAndClamp(
        window.activeVisualParams, mods, 0.55
      );
    }
    if (!window.activeVisualParams) {
      window.activeVisualParams = {};
    }
    const vp = window.activeVisualParams;
    if (vs) {
      vp.texturePattern = vs.texturePattern;
      vp.strokeBehavior = vs.strokeBehavior;
      vp.strokePattern = vs.strokePattern;
      vp.motionModel = vs.motionModel;
      vp.paletteBias = vs.paletteBias;
    }
    vp.archetypeId = archetypeId;
    vp.palette = palette;
    vp.soundColorSeed = SoundColorEngine?.featureSeed(pyData?.features) ?? 0;

    if (window.brushGenerator?.resetInkColor) {
      window.brushGenerator.resetInkColor(palette[0]);
    }
    if (window.brushGenerator?.clear) {
      window.brushGenerator.clear();
    }
    if (window.App?.canvasInteraction?.leftField?.updatePalette) {
      window.App.canvasInteraction.leftField.updatePalette(palette);
    }

    const hints = vs?.brushHints || {};
    if (window.activeBrushParams && hints) {
      window.activeBrushParams = {
        ...window.activeBrushParams,
        density: hints.density ?? window.activeBrushParams.density,
        turbulence: hints.turbulence ?? window.activeBrushParams.turbulence,
        motion: hints.motion ?? window.activeBrushParams.motion,
        continuity: hints.continuity ?? window.activeBrushParams.continuity,
        smoothness: hints.smoothness ?? window.activeBrushParams.smoothness,
        rotationSpeed: hints.rotationSpeed ?? window.activeBrushParams.rotationSpeed
      };
    }
    window.activeFusedVisualParams = vp;
    return vp;
  },

  applyFromFeatures(pyData) {
    const features = pyData?.features;
    if (!features) return null;
    const exportData = pyData.analysisExport || {};
    const vs = pyData.analysisExport?.visualStructure || pyData.visualStructure || null;
    const archetypeId = this.resolveArchetypeId(vs, exportData);
    const palette = this.buildSignaturePalette(features, archetypeId);
    window.activeNaturalArchetype = exportData.naturalArchetype || null;
    window.activeVisualStructure = vs;
    return this.stampVisualParams(vs, archetypeId, palette, pyData);
  },

  applyVisualStructure(pyData) {
    const vs = pyData?.analysisExport?.visualStructure || pyData?.visualStructure;
    const features = pyData?.features;
    if (!vs && !features) return null;

    const exportData = pyData.analysisExport || {};
    window.activeNaturalArchetype = exportData.naturalArchetype || null;
    window.activeVisualStructure = vs;

    const archetypeId = this.resolveArchetypeId(vs, exportData);
    const palette = this.buildSignaturePalette(features, archetypeId);
    return this.stampVisualParams(vs, archetypeId, palette, pyData);
  },

  formatExportSummary(exportData) {
    const arch = exportData?.naturalArchetype;
    const vs = exportData?.visualStructure;
    if (!arch) return "";
    return `${arch.labelZh || arch.id} · 置信 ${Math.round((arch.confidence || 0) * 100)}% · ` +
      `${vs?.strokePattern || ""} / ${vs?.motionModel || ""}`;
  }
};

window.NaturalSoundArchetypes = NaturalSoundArchetypes;
