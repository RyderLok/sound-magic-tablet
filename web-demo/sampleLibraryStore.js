// IndexedDB persistence — each recording stays independent with full analysis memory.
const SampleLibraryStore = {
  DB_NAME: "SoundMagicTablet",
  STORE: "samples",
  VERSION: 1,

  async open() {
    if (this._db) return this._db;
    this._db = await new Promise((resolve, reject) => {
      const req = indexedDB.open(this.DB_NAME, this.VERSION);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => resolve(req.result);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(this.STORE)) {
          db.createObjectStore(this.STORE, { keyPath: "id" });
        }
      };
    });
    return this._db;
  },

  _serialize(sample) {
    const snap = sample.waveformSnapshot;
    return {
      id: sample.id,
      name: sample.name,
      fileName: sample.fileName,
      duration: sample.duration,
      waveformSnapshot: snap ? Array.from(snap) : [],
      status: sample.status,
      source: sample.source,
      esp32MetricsSeries: sample.esp32MetricsSeries || null,
      esp32UsedPcm: !!sample.esp32UsedPcm,
      features: sample.features || null,
      aiResult: sample.aiResult || null,
      visualParams: sample.visualParams || null,
      acoustic: sample.acoustic || null,
      shapeProfile: sample.shapeProfile || null,
      pythonAnalysis: sample.pythonAnalysis || null,
      pythonBrush: sample.pythonBrush || null,
      analysisHistory: sample.analysisHistory || [],
      createdAt: sample.createdAt || Date.now(),
      updatedAt: Date.now(),
      audioBlob: sample.file
    };
  },

  _deserialize(row) {
    if (!row) return null;
    const blob = row.audioBlob;
    const file = blob instanceof Blob
      ? new File([blob], row.fileName || "recording.wav", { type: blob.type || "audio/wav" })
      : null;
    if (!file) return null;

    return {
      id: row.id,
      name: row.name,
      fileName: row.fileName,
      file,
      duration: row.duration,
      waveformSnapshot: new Float32Array(row.waveformSnapshot || []),
      status: row.status || "ready",
      source: row.source || "import",
      esp32MetricsSeries: row.esp32MetricsSeries || null,
      esp32UsedPcm: !!row.esp32UsedPcm,
      features: row.features || null,
      aiResult: row.aiResult || null,
      visualParams: row.visualParams || null,
      acoustic: row.acoustic || null,
      shapeProfile: row.shapeProfile || null,
      pythonAnalysis: row.pythonAnalysis || null,
      pythonBrush: row.pythonBrush || null,
      analysisHistory: row.analysisHistory || [],
      createdAt: row.createdAt || Date.now(),
      updatedAt: row.updatedAt || row.createdAt || Date.now()
    };
  },

  async loadAll() {
    try {
      const db = await this.open();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(this.STORE, "readonly");
        const req = tx.objectStore(this.STORE).getAll();
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const rows = (req.result || [])
            .map((r) => this._deserialize(r))
            .filter(Boolean)
            .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
          resolve(rows);
        };
      });
    } catch (err) {
      console.warn("[SampleLibraryStore] load failed:", err);
      return [];
    }
  },

  async saveSample(sample) {
    if (!sample?.id || !sample.file) return;
    try {
      const db = await this.open();
      const row = this._serialize(sample);
      await new Promise((resolve, reject) => {
        const tx = db.transaction(this.STORE, "readwrite");
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.objectStore(this.STORE).put(row);
      });
    } catch (err) {
      console.warn("[SampleLibraryStore] save failed:", err);
    }
  },

  async deleteSample(sampleId) {
    try {
      const db = await this.open();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(this.STORE, "readwrite");
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.objectStore(this.STORE).delete(sampleId);
      });
    } catch (err) {
      console.warn("[SampleLibraryStore] delete failed:", err);
    }
  },

  appendAnalysisHistory(sample, entry) {
    if (!sample) return;
    if (!Array.isArray(sample.analysisHistory)) sample.analysisHistory = [];
    sample.analysisHistory.push({
      at: Date.now(),
      ...entry
    });
    if (sample.analysisHistory.length > 20) {
      sample.analysisHistory = sample.analysisHistory.slice(-20);
    }
  }
};

window.SampleLibraryStore = SampleLibraryStore;
