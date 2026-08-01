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

  categoryToPattern: {
    birds: "scatter_points",
    wind_leaves: "flow_field",
    water: "wave_ripple",
    material_impact: "impact_burst",
    insects_amphibians: "pulse_grid"
  },

  patternFor(categoryId) {
    return this.categoryToPattern[categoryId] || null;
  },

  biasToArchetype: {
    bright_warm: "birds",
    cool_muted: "wind_leaves",
    cool_blue_green: "water",
    earth_contrast: "material_impact",
    mid_high_buzz: "insects_amphibians"
  },

  resolveArchetypeId(vs, exportData, pyData) {
    // Qwen is the sole category source for strokePattern.
    return pyData?.semantic?.archetype
      || exportData?.category
      || vs?.archetypeId
      || exportData?.visualStructure?.archetypeId
      || null;
  },

  buildSignaturePalette(features, archetypeId, acousticFeatures) {
    if (typeof SoundColorEngine !== "undefined") {
      return SoundColorEngine.buildFromFeatures(features, archetypeId, acousticFeatures);
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

    // Category templates must not overwrite acoustic brushParams.
    window.activeFusedVisualParams = vp;
    return vp;
  },

  applyFromFeatures(pyData) {
    const features = pyData?.features;
    if (!features) return null;
    const exportData = pyData.analysisExport || {};
    const vs = exportData.visualStructure || pyData.visualStructure || null;
    const archetypeId = this.resolveArchetypeId(vs, exportData, pyData);
    const acousticFeatures = exportData.acousticFeatures || pyData.acousticFeatures || null;
    const palette = this.buildSignaturePalette(features, archetypeId, acousticFeatures);
    window.activeNaturalArchetype = archetypeId
      ? { id: archetypeId, labelZh: this.labels[archetypeId]?.zh, source: "qwen" }
      : null;
    window.activeVisualStructure = vs;
    window.activeAcousticFeatures = acousticFeatures;
    return this.stampVisualParams(vs, archetypeId, palette, pyData);
  },

  applyVisualStructure(pyData) {
    const vs = pyData?.analysisExport?.visualStructure || pyData?.visualStructure;
    const features = pyData?.features;
    if (!vs && !features) return null;

    const exportData = pyData.analysisExport || {};
    const archetypeId = this.resolveArchetypeId(vs, exportData, pyData);
    const acousticFeatures = exportData.acousticFeatures || null;
    window.activeNaturalArchetype = archetypeId
      ? { id: archetypeId, labelZh: this.labels[archetypeId]?.zh, source: "qwen" }
      : null;
    window.activeVisualStructure = vs;
    window.activeAcousticFeatures = acousticFeatures;

    const palette = this.buildSignaturePalette(features, archetypeId, acousticFeatures);
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
