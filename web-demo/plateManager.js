// Paint plate — collect up to 5 analyzed recordings as brushes on one canvas.
const PlateManager = {
  MAX_BRUSHES: 5,
  STORAGE_KEY: "smt_plate_brush_ids",

  selectedIds: [],
  activeBrushId: null,

  load() {
    try {
      const raw = localStorage.getItem(this.STORAGE_KEY);
      const ids = raw ? JSON.parse(raw) : [];
      this.selectedIds = Array.isArray(ids) ? ids.slice(0, this.MAX_BRUSHES) : [];
    } catch (_) {
      this.selectedIds = [];
    }
    return this.selectedIds;
  },

  save() {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.selectedIds));
    } catch (_) { /* noop */ }
  },

  isSelected(sampleId) {
    return this.selectedIds.includes(sampleId);
  },

  count() {
    return this.selectedIds.length;
  },

  getSelectedSamples(app) {
    if (!app?.soundLibrary) return [];
    return this.selectedIds
      .map((id) => app.soundLibrary.find((s) => s.id === id))
      .filter(Boolean);
  },

  toggle(app, sampleId) {
    const idx = this.selectedIds.indexOf(sampleId);
    if (idx >= 0) {
      this.selectedIds.splice(idx, 1);
      if (this.activeBrushId === sampleId) {
        this.activeBrushId = this.selectedIds[0] || null;
      }
    } else {
      if (this.selectedIds.length >= this.MAX_BRUSHES) return false;
      this.selectedIds.push(sampleId);
      if (!this.activeBrushId) this.activeBrushId = sampleId;
    }
    this.save();
    return true;
  },

  remove(app, sampleId) {
    const idx = this.selectedIds.indexOf(sampleId);
    if (idx === -1) return;
    this.selectedIds.splice(idx, 1);
    if (this.activeBrushId === sampleId) {
      this.activeBrushId = this.selectedIds[0] || null;
    }
    this.save();
  },

  setActiveBrush(sampleId) {
    if (!this.selectedIds.includes(sampleId)) return;
    this.activeBrushId = sampleId;
  },

  isBrushReady(sample) {
    if (!sample) return false;
    if (sample.status === "analyzed") return true;
    if (sample.visualParams && (sample.features || sample.pythonBrush || sample.aiResult)) {
      return true;
    }
    return false;
  },

  brushReadySamples(app) {
    return this.getSelectedSamples(app).filter((s) => this.isBrushReady(s));
  },

  notBrushReadyNames(app) {
    return this.getSelectedSamples(app)
      .filter((s) => !this.isBrushReady(s))
      .map((s) => s.name);
  },

  allBrushReady(app) {
    const samples = this.getSelectedSamples(app);
    return samples.length > 0 && samples.every((s) => this.isBrushReady(s));
  },

  mergePalettes(samples) {
    const merged = [];
    const seen = new Set();
    for (const s of samples) {
      const pal = s.visualParams?.palette || [];
      for (const c of pal) {
        const key = `${c.r},${c.g},${c.b}`;
        if (!seen.has(key)) {
          seen.add(key);
          merged.push({ r: c.r, g: c.g, b: c.b });
        }
        if (merged.length >= 12) return merged;
      }
    }
    return merged;
  },

  buildPlateVisualParams(app) {
    const samples = this.brushReadySamples(app);
    if (!samples.length) return null;
    const platePalette = this.mergePalettes(samples);
    const active = samples.find((s) => s.id === this.activeBrushId) || samples[0];
    if (!active?.visualParams) return null;

    const vp = { ...active.visualParams };
    if (platePalette.length) vp.palette = platePalette;
    vp._plateBrushCount = samples.length;
    vp._activeBrushName = active.name;
    return { active, samples, platePalette, visualParams: vp };
  }
};

window.PlateManager = PlateManager;
