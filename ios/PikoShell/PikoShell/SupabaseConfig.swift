import Foundation

/// Supabase client config for iPad — **anon key only** (never service_role).
final class SupabaseConfig: ObservableObject {
    static let shared = SupabaseConfig()

    private let urlKey = "piko.supabaseUrl"
    private let anonKeyKey = "piko.supabaseAnonKey"
    private let bucketKey = "piko.supabaseBucket"

    /// Public project URL (not secret) — prefilled so Settings only needs the anon key.
    static let defaultProjectURL = "https://vfyzxhzpdlxnrugqomda.supabase.co"

    @Published var url: String {
        didSet { UserDefaults.standard.set(url, forKey: urlKey) }
    }
    @Published var anonKey: String {
        didSet { UserDefaults.standard.set(anonKey, forKey: anonKeyKey) }
    }
    @Published var bucket: String {
        didSet { UserDefaults.standard.set(bucket, forKey: bucketKey) }
    }

    @Published var lastSelfTestSummary: String = ""

    var isConfigured: Bool {
        let u = url.trimmingCharacters(in: .whitespacesAndNewlines)
        let k = anonKey.trimmingCharacters(in: .whitespacesAndNewlines)
        return u.hasPrefix("http") && !k.isEmpty && !looksLikeServiceRole(k)
    }

    var normalizedURL: String {
        url.trimmingCharacters(in: .whitespacesAndNewlines)
            .trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    }

    var bucketName: String {
        let b = bucket.trimmingCharacters(in: .whitespacesAndNewlines)
        return b.isEmpty ? "sounds" : b
    }

    private init() {
        let defaults = UserDefaults.standard
        var loadedURL = defaults.string(forKey: urlKey) ?? ""
        var loadedAnon = defaults.string(forKey: anonKeyKey) ?? ""
        var loadedBucket = defaults.string(forKey: bucketKey) ?? "sounds"

        // Optional gitignored Secrets.plist in the app bundle / Documents.
        if let secrets = Self.loadSecretsPlist() {
            if loadedURL.isEmpty, let u = secrets["SUPABASE_URL"], !u.isEmpty { loadedURL = u }
            if loadedAnon.isEmpty, let k = secrets["SUPABASE_ANON_KEY"], !k.isEmpty { loadedAnon = k }
            if let b = secrets["SUPABASE_SOUNDS_BUCKET"], !b.isEmpty { loadedBucket = b }
        }

        if loadedURL.isEmpty {
            loadedURL = Self.defaultProjectURL
        }
        if loadedBucket.isEmpty {
            loadedBucket = "sounds"
        }

        url = loadedURL
        anonKey = loadedAnon
        bucket = loadedBucket
    }

    func authHeaders(contentType: String? = "application/json") -> [String: String] {
        let key = anonKey.trimmingCharacters(in: .whitespacesAndNewlines)
        var h: [String: String] = [
            "apikey": key,
            "Authorization": "Bearer \(key)",
        ]
        if let contentType { h["Content-Type"] = contentType }
        return h
    }

    /// Reject accidental paste of service_role JWT (role claim).
    func looksLikeServiceRole(_ key: String) -> Bool {
        let parts = key.split(separator: ".")
        guard parts.count >= 2 else { return false }
        var payload = String(parts[1])
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        while payload.count % 4 != 0 { payload.append("=") }
        guard let data = Data(base64Encoded: payload),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let role = obj["role"] as? String
        else { return false }
        return role == "service_role"
    }

    private static func loadSecretsPlist() -> [String: String]? {
        let candidates: [URL?] = [
            Bundle.main.url(forResource: "Secrets", withExtension: "plist"),
            FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first?
                .appendingPathComponent("Secrets.plist"),
        ]
        for url in candidates.compactMap({ $0 }) {
            guard let dict = NSDictionary(contentsOf: url) as? [String: Any] else { continue }
            var out: [String: String] = [:]
            for (k, v) in dict {
                out[k] = String(describing: v)
            }
            if !out.isEmpty { return out }
        }
        return nil
    }
}
