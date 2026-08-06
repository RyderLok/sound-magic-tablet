import Foundation

/// SiliconFlow / Qwen3-Omni — API key stored in Settings only (never commit).
final class SiliconFlowConfig: ObservableObject {
    static let shared = SiliconFlowConfig()

    private let keyKey = "piko.siliconflowApiKey"
    private let modelKey = "piko.siliconflowModel"
    private let baseKey = "piko.siliconflowBaseUrl"
    private let enabledKey = "piko.siliconflowEnabled"

    @Published var apiKey: String {
        didSet { UserDefaults.standard.set(apiKey, forKey: keyKey) }
    }
    @Published var model: String {
        didSet { UserDefaults.standard.set(model, forKey: modelKey) }
    }
    @Published var baseURL: String {
        didSet { UserDefaults.standard.set(baseURL, forKey: baseKey) }
    }
    @Published var enabled: Bool {
        didSet { UserDefaults.standard.set(enabled, forKey: enabledKey) }
    }

    var isConfigured: Bool {
        enabled && !apiKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var normalizedBase: String {
        let b = baseURL.trimmingCharacters(in: .whitespacesAndNewlines)
        if b.isEmpty { return "https://api.siliconflow.cn/v1" }
        return b.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    }

    var modelName: String {
        let m = model.trimmingCharacters(in: .whitespacesAndNewlines)
        return m.isEmpty ? "Qwen/Qwen3-Omni-30B-A3B-Instruct" : m
    }

    private init() {
        apiKey = UserDefaults.standard.string(forKey: keyKey) ?? ""
        model = UserDefaults.standard.string(forKey: modelKey) ?? "Qwen/Qwen3-Omni-30B-A3B-Instruct"
        baseURL = UserDefaults.standard.string(forKey: baseKey) ?? "https://api.siliconflow.cn/v1"
        if UserDefaults.standard.object(forKey: enabledKey) == nil {
            enabled = true
        } else {
            enabled = UserDefaults.standard.bool(forKey: enabledKey)
        }
    }

    func status() -> [String: Any] {
        [
            "configured": isConfigured,
            "model": modelName,
            "baseUrl": normalizedBase,
            "soleSemanticSource": "qwen3-omni",
            "grayscaleArchetypes": [
                "birds", "wind_leaves", "water", "material_impact", "insects_amphibians",
            ],
        ]
    }
}
