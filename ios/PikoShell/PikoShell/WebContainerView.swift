import SwiftUI
import WebKit
import os.log

struct WebContainerView: UIViewRepresentable {
    let urlString: String

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeUIView(context: Context) -> WKWebView {
        let userContent = WKUserContentController()
        userContent.add(context.coordinator, name: PikoWebBridge.logHandlerName)
        userContent.add(context.coordinator, name: PikoWebBridge.galleryHandlerName)
        userContent.addUserScript(PikoWebBridge.galleryResumeUserScript)

        let config = WKWebViewConfiguration()
        config.userContentController = userContent
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        // Avoid stale JS after WebDemo sync / redeploy.
        config.websiteDataStore = .default()

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = context.coordinator
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.isOpaque = false
        webView.backgroundColor = .systemBackground
        context.coordinator.webView = webView
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        let trimmed = urlString.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, let url = URL(string: trimmed) else { return }
        if context.coordinator.lastLoadedURL != url {
            context.coordinator.lastLoadedURL = url
            var request = URLRequest(url: url)
            request.cachePolicy = .reloadIgnoringLocalCacheData
            webView.load(request)
        }
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
        var lastLoadedURL: URL?
        weak var webView: WKWebView?
        private let log = Logger(subsystem: "com.piko.shell", category: "WebBridge")

        func userContentController(
            _ userContentController: WKUserContentController,
            didReceive message: WKScriptMessage
        ) {
            if message.name == PikoWebBridge.logHandlerName {
                log.info("JS: \(String(describing: message.body), privacy: .public)")
                return
            }
            if message.name == PikoWebBridge.galleryHandlerName {
                log.info("Gallery: \(String(describing: message.body), privacy: .public)")
                // Re-assert draw patch after resume (p5 may load late).
                webView?.evaluateJavaScript(
                    "window.__PIKO_NATIVE_GALLERY_BRIDGE__ && window.CanvasInteraction && true;",
                    completionHandler: nil
                )
            }
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            decisionHandler(.allow)
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            injectSupabaseConfig(into: webView)
            // Re-run arm in case scripts loaded after document-end injection.
            webView.evaluateJavaScript(
                """
                (function(){
                  if (window.App && !App.__pikoNativeResumeWrapped && window.__PIKO_NATIVE_GALLERY_BRIDGE__) {
                    /* user script already defines arm via closure; poke resume wrap by reloading hook */
                  }
                  try {
                    if (window.webkit && webkit.messageHandlers && webkit.messageHandlers.pikoLog) {
                      webkit.messageHandlers.pikoLog.postMessage('didFinish navigation');
                    }
                  } catch (e) {}
                })();
                """,
                completionHandler: nil
            )
        }

        private func injectSupabaseConfig(into webView: WKWebView) {
            let cfg = SupabaseConfig.shared
            guard cfg.isConfigured else { return }
            let url = cfg.normalizedURL.replacingOccurrences(of: "\\", with: "\\\\")
                .replacingOccurrences(of: "'", with: "\\'")
            let key = cfg.anonKey.trimmingCharacters(in: .whitespacesAndNewlines)
                .replacingOccurrences(of: "\\", with: "\\\\")
                .replacingOccurrences(of: "'", with: "\\'")
            let bucket = cfg.bucketName
                .replacingOccurrences(of: "\\", with: "\\\\")
                .replacingOccurrences(of: "'", with: "\\'")
            let js = """
            window.PIKO_SUPABASE = window.PIKO_SUPABASE || {};
            window.PIKO_SUPABASE.url = '\(url)';
            window.PIKO_SUPABASE.anonKey = '\(key)';
            window.PIKO_SUPABASE.bucket = '\(bucket)';
            """
            webView.evaluateJavaScript(js, completionHandler: nil)
        }
    }
}
