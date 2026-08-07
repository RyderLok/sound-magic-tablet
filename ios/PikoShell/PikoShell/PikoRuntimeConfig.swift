import Foundation
import Combine

/// Runtime endpoints for independent iPad mode (default) or Mac debug fallback.
final class PikoRuntimeConfig: ObservableObject {
    private let standaloneKey = "piko.standalone"
    private let demoKey = "piko.demoBase"
    private let apiKey = "piko.apiBase"
    private let espKey = "piko.esp32Base"

    /// When true (default), load embedded web-demo from local gateway :8001.
    @Published var standaloneMode: Bool {
        didSet { UserDefaults.standard.set(standaloneMode, forKey: standaloneKey) }
    }

    /// Optional external web-demo URL (Mac :8000) when standaloneMode is false.
    @Published var demoBase: String {
        didSet { UserDefaults.standard.set(demoBase, forKey: demoKey) }
    }

    @Published var apiBase: String {
        didSet { UserDefaults.standard.set(apiBase, forKey: apiKey) }
    }

    @Published var esp32Base: String {
        didSet { UserDefaults.standard.set(esp32Base, forKey: espKey) }
    }

    var lanUploadURL: String {
        LanAddress.uploadHint(port: LocalPikoGateway.port)
    }

    var gatewayRunning: Bool {
        LocalPikoGateway.shared.isRunning
    }

    init() {
        if UserDefaults.standard.object(forKey: standaloneKey) == nil {
            standaloneMode = true
        } else {
            standaloneMode = UserDefaults.standard.bool(forKey: standaloneKey)
        }
        demoBase = UserDefaults.standard.string(forKey: demoKey) ?? ""
        apiBase = UserDefaults.standard.string(forKey: apiKey) ?? ""
        esp32Base = UserDefaults.standard.string(forKey: espKey) ?? ""
    }

    /// URL loaded by WKWebView.
    var startURL: String {
        if standaloneMode {
            return standaloneStartURL()
        }

        let demo = demoBase.trimmingCharacters(in: .whitespacesAndNewlines)
            .trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard !demo.isEmpty else { return standaloneStartURL() }

        var comps = URLComponents(string: demo)
        if comps?.scheme == nil {
            comps = URLComponents(string: "http://\(demo)")
        }
        var items: [URLQueryItem] = comps?.queryItems ?? []
        appendEndpointQuery(&items)
        comps?.queryItems = items.isEmpty ? nil : items
        return comps?.string ?? demo
    }

    private func standaloneStartURL() -> String {
        var comps = URLComponents(string: "http://127.0.0.1:\(LocalPikoGateway.port)/")
        var items: [URLQueryItem] = [
            URLQueryItem(name: "api", value: "http://127.0.0.1:\(LocalPikoGateway.port)"),
            // Bust WKWebView cache so Gallery/Swift bridge + WebDemo sync always load.
            URLQueryItem(name: "piko_build", value: String(Int(Date().timeIntervalSince1970))),
        ]
        let esp = esp32Base.trimmingCharacters(in: .whitespacesAndNewlines)
        if !esp.isEmpty {
            items.append(URLQueryItem(name: "esp32", value: esp))
        }
        comps?.queryItems = items
        return comps?.string ?? "http://127.0.0.1:\(LocalPikoGateway.port)/"
    }

    private func appendEndpointQuery(_ items: inout [URLQueryItem]) {
        let api = apiBase.trimmingCharacters(in: .whitespacesAndNewlines)
        let esp = esp32Base.trimmingCharacters(in: .whitespacesAndNewlines)
        if !api.isEmpty {
            items.removeAll { $0.name == "api" }
            items.append(URLQueryItem(name: "api", value: api))
        }
        if !esp.isEmpty {
            items.removeAll { $0.name == "esp32" }
            items.append(URLQueryItem(name: "esp32", value: esp))
        }
    }
}
