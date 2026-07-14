// Central visual pipeline — ESP32/JS features → Python fusion → BrushGenerator.
const VisualPipeline = {
  tick({ baseParams, personality, aiResult, features }) {
    const py = window.pythonClient;
    const esp = window.esp32AudioAdapter;

    let liveFeatures = FeatureSchema.normalizeFeatures(features);
    if (esp && esp.isConnected && esp.isConnected()) {
      liveFeatures = FeatureSchema.mergeFeatures(liveFeatures, FeatureSchema.fromEsp32Adapter(esp), 0.55);
    }
    if (py && py.lastFeatures) {
      liveFeatures = FeatureSchema.mergeFeatures(liveFeatures, py.lastFeatures, py.connected ? 0.45 : 0.2);
    }
    window.activeAudioFeatures = liveFeatures;

    const locked = window.activeVisualParams || {};
    let visualParams = { ...(baseParams || {}) };
    const pythonMods = (py && py.lastModifiers) ? py.lastModifiers : null;

    if (pythonMods && Object.keys(pythonMods).length) {
      visualParams = VisualParamFusion.mergeAndClamp(visualParams, pythonMods);
    }

    if (py && py.lastBrush) {
      visualParams = BrushSchema.applyToVisualParams(visualParams, py.lastBrush);
    } else {
      const brush = BrushSchema.fromVisualAndModifiers(visualParams, pythonMods, liveFeatures);
      window.activeBrushParams = brush;
      visualParams = BrushSchema.applyToVisualParams(visualParams, brush);
    }

    // Never drop per-recording palette / stroke pattern set by analysis.
    if (locked.palette?.length) {
      visualParams.palette = typeof SoundColorEngine !== "undefined"
        ? SoundColorEngine.modulatePalette(locked.palette, liveFeatures, 0.14)
        : locked.palette;
    } else if (liveFeatures && typeof SoundColorEngine !== "undefined" && (liveFeatures.bass != null || liveFeatures.volume)) {
      visualParams.palette = SoundColorEngine.buildFromFeatures(liveFeatures, locked.archetypeId || null);
    }

    ["strokePattern", "motionModel", "texturePattern", "strokeBehavior", "paletteBias", "archetypeId", "soundColorSeed"]
      .forEach((key) => {
        if (locked[key] != null) visualParams[key] = locked[key];
      });

    window.activeFusedVisualParams = visualParams;
    this._updateDebugPanel(liveFeatures, pythonMods, visualParams);
    return { visualParams, features: liveFeatures, personality, aiResult };
  },

  _updateDebugPanel(features, mods, visualParams) {
    const panel = document.getElementById("debugPanelBody");
    if (!panel || panel.closest(".debug-panel")?.classList.contains("collapsed")) return;

    const fmt = (obj) => JSON.stringify(obj, (k, v) => {
      if (k === "spectrumProfile" && Array.isArray(v)) return `[${v.length} bins]`;
      if (k === "palette") return "[palette]";
      return v;
    }, 2);

    panel.innerHTML = `
      <pre class="debug-block"><b>ESP32 / live features</b>\n${fmt(features)}</pre>
      <pre class="debug-block"><b>Python modifiers</b>\n${fmt(mods || {})}</pre>
      <pre class="debug-block"><b>Final brush / visual</b>\n${fmt({
        brush: window.activeBrushParams,
        strokePattern: visualParams.strokePattern,
        archetypeId: visualParams.archetypeId,
        palettePreview: visualParams.palette?.slice(0, 2),
        motionSpeed: visualParams.motionSpeed,
        particleDensity: visualParams.particleDensity,
        pythonWeight: VisualParamFusion.pythonWeight
      })}</pre>`;
  }
};

window.VisualPipeline = VisualPipeline;
