import Foundation
import WebKit

/// Native WKWebView bridge: Gallery 续画强制可见（不依赖可能被缓存的旧 web-demo 脚本）。
enum PikoWebBridge {
    static let logHandlerName = "pikoLog"
    static let galleryHandlerName = "pikoGallery"

    /// Injected at document-end on every page load (lives in the app binary).
    static var galleryResumeUserScript: WKUserScript {
        WKUserScript(
            source: galleryResumeJavaScript,
            injectionTime: .atDocumentEnd,
            forMainFrameOnly: true
        )
    }

    /// Bulletproof Gallery resume + draw hook for iPad WKWebView.
    private static let galleryResumeJavaScript = #"""
(function () {
  if (window.__PIKO_NATIVE_GALLERY_BRIDGE__) return;
  window.__PIKO_NATIVE_GALLERY_BRIDGE__ = true;

  function nativeLog(msg) {
    try {
      if (window.webkit && webkit.messageHandlers && webkit.messageHandlers.pikoLog) {
        webkit.messageHandlers.pikoLog.postMessage(String(msg));
      }
    } catch (e) {}
    try { console.log("[PikoNativeGallery]", msg); } catch (e2) {}
  }

  function blobToDrawable(blob) {
    return new Promise(function (resolve, reject) {
      if (!blob) return reject(new Error("empty blob"));
      if (typeof createImageBitmap === "function") {
        createImageBitmap(blob).then(resolve).catch(function () {
          viaImage();
        });
        return;
      }
      viaImage();
      function viaImage() {
        var url = URL.createObjectURL(blob);
        var img = new Image();
        img.onload = function () {
          URL.revokeObjectURL(url);
          resolve(img);
        };
        img.onerror = function () {
          URL.revokeObjectURL(url);
          reject(new Error("image decode failed"));
        };
        img.src = url;
      }
    });
  }

  function drawRestore(img) {
    if (!img || typeof drawingContext === "undefined") return;
    if (typeof width !== "number" || typeof height !== "number") return;
    if (width < 2 || height < 2) return;
    try {
      var ctx = drawingContext;
      ctx.save();
      var d = 1;
      try {
        if (typeof pixelDensity === "function") d = pixelDensity() || 1;
      } catch (e) {}
      ctx.setTransform(d, 0, 0, d, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      ctx.drawImage(img, 0, 0, width, height);
      ctx.restore();
    } catch (err) {
      nativeLog("drawRestore fail: " + err);
    }
  }

  function patchDrawCenterCanvas() {
    if (!window.CanvasInteraction || !CanvasInteraction.prototype) return false;
    if (CanvasInteraction.prototype.__pikoNativeCenterPatched) return true;
    var orig = CanvasInteraction.prototype.drawCenterCanvas;
    CanvasInteraction.prototype.drawCenterCanvas = function (l, visualParameters) {
      if (l && l.pikoFull) {
        noStroke();
        fill(255, 255, 255);
        rect(0, 0, width, height);
        // 白底之后立刻铺 Gallery 原图（解决原先只写进离屏层、主画布仍空白）
        var img = window.__PIKO_GALLERY_IMG__ ||
          (this._artworkBaseActive && this._artworkRestoreImg) ||
          null;
        if (img) drawRestore(img);
        return;
      }
      if (typeof orig === "function") return orig.call(this, l, visualParameters);
    };
    CanvasInteraction.prototype.__pikoNativeCenterPatched = true;
    nativeLog("drawCenterCanvas patched");
    return true;
  }

  function patchClearRestore() {
    if (!window.CanvasInteraction || !CanvasInteraction.prototype) return;
    if (CanvasInteraction.prototype.__pikoNativeClearPatched) return;
    var origClear = CanvasInteraction.prototype.clearArtworkRestore;
    CanvasInteraction.prototype.clearArtworkRestore = function () {
      window.__PIKO_GALLERY_IMG__ = null;
      if (typeof origClear === "function") return origClear.call(this);
      this._artworkRestoreImg = null;
      this._artworkRestoreBlob = null;
      this._artworkRestorePending = false;
      this._artworkBaseActive = false;
    };
    CanvasInteraction.prototype.__pikoNativeClearPatched = true;
  }

  function wrapResume() {
    if (!window.App) return false;
    if (App.__pikoNativeResumeWrapped) return true;
    var orig = App.resumeGalleryArtwork;
    App.resumeGalleryArtwork = async function (artId) {
      nativeLog("resumeGalleryArtwork " + artId);
      patchDrawCenterCanvas();
      patchClearRestore();

      if (!window.GalleryStore || typeof GalleryStore.get !== "function") {
        nativeLog("GalleryStore missing");
        if (typeof orig === "function") return orig.call(App, artId);
        return;
      }

      var art = await GalleryStore.get(artId);
      if (!art || !art.imageBlob) {
        nativeLog("artwork blob missing");
        if (typeof orig === "function") return orig.call(App, artId);
        return;
      }

      try {
        var drawable = await blobToDrawable(art.imageBlob);
        window.__PIKO_GALLERY_IMG__ = drawable;
        nativeLog("decoded artwork ok");
      } catch (err) {
        nativeLog("decode error: " + err);
      }

      if (typeof orig === "function") {
        await orig.call(App, artId);
      }

      if (window.__PIKO_GALLERY_IMG__ && App.canvasInteraction) {
        App.canvasInteraction._artworkRestoreImg = window.__PIKO_GALLERY_IMG__;
        App.canvasInteraction._artworkBaseActive = true;
        App.canvasInteraction._artworkRestorePending = true;
        try {
          if (typeof App.canvasInteraction._blitArtworkImage === "function") {
            App.canvasInteraction._blitArtworkImage(window.__PIKO_GALLERY_IMG__);
          }
        } catch (e) {}
      }

      // 再强制恢复一次笔刷色槽（旧画无 snapshot 时走曲库回填）
      try {
        var brushN = 0;
        if (window.PlateManager) {
          brushN = (PlateManager.getSelectedSamples(App) || []).length;
        }
        if (!brushN && art && art.brushSnapshot && typeof App.restoreBrushSnapshot === "function") {
          App.restoreBrushSnapshot(art.brushSnapshot);
          brushN = (PlateManager.getSelectedSamples(App) || []).length;
        }
        if (!brushN && typeof App.restoreBrushesFromLibraryFallback === "function") {
          await App.restoreBrushesFromLibraryFallback();
          brushN = (PlateManager.getSelectedSamples(App) || []).length;
        }
        nativeLog("brushes on plate: " + brushN);
      } catch (brErr) {
        nativeLog("brush restore err: " + brErr);
      }

      if (window.PikoCanvasScreen && typeof PikoCanvasScreen.renderPalette === "function") {
        PikoCanvasScreen.renderPalette();
      }
      if (typeof App.renderBrushStrip === "function") App.renderBrushStrip();

      try {
        if (webkit.messageHandlers.pikoGallery) {
          webkit.messageHandlers.pikoGallery.postMessage({
            type: "resumed",
            id: String(artId || ""),
            hasImage: !!window.__PIKO_GALLERY_IMG__,
            brushCount: (window.PlateManager && App)
              ? (PlateManager.getSelectedSamples(App) || []).length
              : 0
          });
        }
      } catch (e3) {}
    };
    App.__pikoNativeResumeWrapped = true;
    nativeLog("resumeGalleryArtwork wrapped");
    return true;
  }

  function arm() {
    var okDraw = patchDrawCenterCanvas();
    patchClearRestore();
    var okResume = wrapResume();
    if (okDraw && okResume) {
      nativeLog("bridge armed");
      return;
    }
    setTimeout(arm, 250);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", arm);
  } else {
    arm();
  }
})();
"""#
}
