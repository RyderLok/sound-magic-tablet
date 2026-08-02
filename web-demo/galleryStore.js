/**
 * My Gallery — 画纸作品持久化（IndexedDB，浏览器本地）
 * 与录音库 SampleLibraryStore 分开，避免互相升版本。
 */
const GalleryStore = {
  DB_NAME: 'PikoGallery',
  STORE: 'artworks',
  VERSION: 1,

  async open() {
    if (this._db) return this._db;
    this._db = await new Promise(function (resolve, reject) {
      var req = indexedDB.open(GalleryStore.DB_NAME, GalleryStore.VERSION);
      req.onerror = function () { reject(req.error); };
      req.onsuccess = function () { resolve(req.result); };
      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains(GalleryStore.STORE)) {
          db.createObjectStore(GalleryStore.STORE, { keyPath: 'id' });
        }
      };
    });
    return this._db;
  },

  async list() {
    try {
      var db = await this.open();
      return await new Promise(function (resolve, reject) {
        var tx = db.transaction(GalleryStore.STORE, 'readonly');
        var req = tx.objectStore(GalleryStore.STORE).getAll();
        req.onerror = function () { reject(req.error); };
        req.onsuccess = function () {
          var rows = (req.result || []).slice().sort(function (a, b) {
            return (b.createdAt || 0) - (a.createdAt || 0);
          });
          resolve(rows);
        };
      });
    } catch (err) {
      console.warn('[GalleryStore] list failed:', err);
      return [];
    }
  },

  async save(artwork) {
    if (!artwork || !artwork.id || !artwork.imageBlob) return null;
    try {
      var db = await this.open();
      var row = {
        id: artwork.id,
        title: artwork.title || 'Untitled',
        width: artwork.width || 0,
        height: artwork.height || 0,
        createdAt: artwork.createdAt || Date.now(),
        imageBlob: artwork.imageBlob
      };
      await new Promise(function (resolve, reject) {
        var tx = db.transaction(GalleryStore.STORE, 'readwrite');
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
        tx.objectStore(GalleryStore.STORE).put(row);
      });
      return row;
    } catch (err) {
      console.warn('[GalleryStore] save failed:', err);
      return null;
    }
  },

  async delete(id) {
    try {
      var db = await this.open();
      await new Promise(function (resolve, reject) {
        var tx = db.transaction(GalleryStore.STORE, 'readwrite');
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
        tx.objectStore(GalleryStore.STORE).delete(id);
      });
    } catch (err) {
      console.warn('[GalleryStore] delete failed:', err);
    }
  }
};

window.GalleryStore = GalleryStore;
