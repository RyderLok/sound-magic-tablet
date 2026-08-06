import Foundation

/// Upload / list / download / self-test via Supabase REST + Storage (anon key + RLS).
enum SupabaseSoundsClient {
    enum ClientError: LocalizedError {
        case notConfigured
        case serviceRoleForbidden
        case http(Int, String)
        case decode

        var errorDescription: String? {
            switch self {
            case .notConfigured:
                return "Supabase URL / anon key not set in Settings"
            case .serviceRoleForbidden:
                return "Do not paste service_role into the App — use anon public key"
            case .http(let code, let body):
                return "Supabase HTTP \(code): \(body)"
            case .decode:
                return "Supabase response decode failed"
            }
        }
    }

    private static func requireConfig() throws -> SupabaseConfig {
        let cfg = SupabaseConfig.shared
        let key = cfg.anonKey.trimmingCharacters(in: .whitespacesAndNewlines)
        if cfg.looksLikeServiceRole(key) { throw ClientError.serviceRoleForbidden }
        guard cfg.isConfigured else { throw ClientError.notConfigured }
        return cfg
    }

    static func uploadWav(
        _ wav: Data,
        name: String?,
        durationMs: Int,
        sampleRate: Int,
        source: String
    ) async throws -> [String: Any] {
        let cfg = try requireConfig()
        let soundId = UUID().uuidString.lowercased()
        let storagePath = "\(soundId).wav"
        let base = cfg.normalizedURL
        let bucket = cfg.bucketName

        try await uploadStorageObject(wav, bucket: bucket, path: storagePath, base: base, cfg: cfg)

        var display = (name ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if display.isEmpty {
            let existing = (try? await listSounds()) ?? []
            display = "sound\(existing.count + 1)"
        }

        let row: [String: Any] = [
            "id": soundId,
            "name": display,
            "duration_ms": durationMs,
            "sample_rate": sampleRate,
            "upload_status": "uploaded",
            "storage_path": storagePath,
            "source": source,
        ]

        do {
            return try await insertSoundRow(row, base: base, cfg: cfg)
        } catch {
            // Best-effort cleanup so failed metadata does not leave orphans.
            try? await deleteStorageObject(bucket: bucket, path: storagePath, base: base, cfg: cfg)
            throw error
        }
    }

    static func listSounds(since: String? = nil) async throws -> [[String: Any]] {
        let cfg = try requireConfig()
        var comps = URLComponents(string: "\(cfg.normalizedURL)/rest/v1/sounds")
        var items = [
            URLQueryItem(name: "select", value: "*"),
            URLQueryItem(name: "order", value: "created_at.desc"),
        ]
        if let since, !since.isEmpty {
            items.append(URLQueryItem(name: "created_at", value: "gte.\(since)"))
        }
        comps?.queryItems = items
        guard let url = comps?.url else { throw ClientError.notConfigured }

        var req = URLRequest(url: url, timeoutInterval: 30)
        req.httpMethod = "GET"
        cfg.authHeaders(contentType: nil).forEach { req.setValue($0.value, forHTTPHeaderField: $0.key) }
        req.setValue("application/json", forHTTPHeaderField: "Accept")

        let (data, resp) = try await URLSession.shared.data(for: req)
        try throwIfHTTPError(resp, data: data)
        guard let rows = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else {
            throw ClientError.decode
        }
        return rows
    }

    static func getSound(id: String) async throws -> [String: Any]? {
        let cfg = try requireConfig()
        var comps = URLComponents(string: "\(cfg.normalizedURL)/rest/v1/sounds")
        comps?.queryItems = [
            URLQueryItem(name: "select", value: "*"),
            URLQueryItem(name: "id", value: "eq.\(id)"),
            URLQueryItem(name: "limit", value: "1"),
        ]
        guard let url = comps?.url else { throw ClientError.notConfigured }
        var req = URLRequest(url: url, timeoutInterval: 20)
        req.httpMethod = "GET"
        cfg.authHeaders(contentType: nil).forEach { req.setValue($0.value, forHTTPHeaderField: $0.key) }
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        let (data, resp) = try await URLSession.shared.data(for: req)
        try throwIfHTTPError(resp, data: data)
        let rows = (try? JSONSerialization.jsonObject(with: data) as? [[String: Any]]) ?? []
        return rows.first
    }

    static func downloadAudio(storagePath: String) async throws -> Data {
        let cfg = try requireConfig()
        let path = storagePath.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        let encoded = path.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? path
        guard let url = URL(string: "\(cfg.normalizedURL)/storage/v1/object/\(cfg.bucketName)/\(encoded)") else {
            throw ClientError.notConfigured
        }
        var req = URLRequest(url: url, timeoutInterval: 90)
        req.httpMethod = "GET"
        cfg.authHeaders(contentType: nil).forEach { req.setValue($0.value, forHTTPHeaderField: $0.key) }
        let (data, resp) = try await URLSession.shared.data(for: req)
        try throwIfHTTPError(resp, data: data)
        return data
    }

    /// End-to-end: list → upload tiny WAV → download → delete. Returns JSON-friendly report.
    static func selfTest() async -> [String: Any] {
        var steps: [[String: Any]] = []
        func add(_ name: String, _ ok: Bool, _ detail: String = "") {
            steps.append(["step": name, "ok": ok, "detail": detail])
        }

        do {
            _ = try requireConfig()
        } catch {
            return [
                "ok": false,
                "configured": false,
                "steps": [["step": "config", "ok": false, "detail": error.localizedDescription]],
                "hint": "Settings → paste anon public key; run python-service/supabase_sounds.sql in SQL Editor",
            ]
        }

        do {
            let rows = try await listSounds()
            add("list", true, "count=\(rows.count)")
        } catch {
            add("list", false, error.localizedDescription)
            return failReport(steps, hint: "SELECT policy missing? Re-run supabase_sounds.sql")
        }

        let silence = PcmWav.pcm16leToWav(Data(count: 1600), sampleRate: 16000) // 50ms silence
        var uploadedId = ""
        var storagePath = ""
        do {
            let row = try await uploadWav(
                silence,
                name: "ipad-selftest",
                durationMs: 50,
                sampleRate: 16000,
                source: "ipad-selftest"
            )
            uploadedId = String(describing: row["id"] ?? "")
            storagePath = (row["storage_path"] as? String) ?? "\(uploadedId).wav"
            add("upload", true, "id=\(uploadedId)")
        } catch {
            add("upload", false, error.localizedDescription)
            return failReport(steps, hint: "INSERT/Storage policy missing? Re-run supabase_sounds.sql")
        }

        do {
            let blob = try await downloadAudio(storagePath: storagePath)
            add("download", blob.count > 44, "bytes=\(blob.count)")
        } catch {
            add("download", false, error.localizedDescription)
        }

        if !uploadedId.isEmpty {
            do {
                try await deleteSound(id: uploadedId, storagePath: storagePath)
                add("cleanup", true, "deleted \(uploadedId)")
            } catch {
                add("cleanup", false, error.localizedDescription)
            }
        }

        let ok = steps.allSatisfy { ($0["ok"] as? Bool) == true }
        return [
            "ok": ok,
            "configured": true,
            "steps": steps,
            "hint": ok
                ? "Supabase iPad path OK — new ESP uploads and historical list will use the cloud."
                : "Fix failing step; usually SQL policies or wrong anon key.",
        ]
    }

    static func deleteSound(id: String, storagePath: String) async throws {
        let cfg = try requireConfig()
        let base = cfg.normalizedURL
        try await deleteStorageObject(bucket: cfg.bucketName, path: storagePath, base: base, cfg: cfg)

        var comps = URLComponents(string: "\(base)/rest/v1/sounds")
        comps?.queryItems = [URLQueryItem(name: "id", value: "eq.\(id)")]
        guard let url = comps?.url else { throw ClientError.notConfigured }
        var req = URLRequest(url: url, timeoutInterval: 20)
        req.httpMethod = "DELETE"
        cfg.authHeaders().forEach { req.setValue($0.value, forHTTPHeaderField: $0.key) }
        req.setValue("return=minimal", forHTTPHeaderField: "Prefer")
        let (data, resp) = try await URLSession.shared.data(for: req)
        try throwIfHTTPError(resp, data: data)
    }

    static func backendStatus() -> [String: Any] {
        let cfg = SupabaseConfig.shared
        let local = PikoSoundStore.shared.backendStatus()
        if cfg.isConfigured {
            return [
                "configured": true,
                "bucket": cfg.bucketName,
                "backend": "supabase",
                "sourceOfTruth": "supabase",
                "transport": "ipad-anon",
                "localDir": local["localDir"] as? String ?? "",
                "localCount": local["localCount"] as? Int ?? 0,
                "lastSelfTest": cfg.lastSelfTestSummary,
                "hint": "iPad uploads to Supabase (anon + RLS). Local Documents is cache.",
            ]
        }
        var st = local
        st["hint"] = "Paste anon public key in Settings to enable cloud history + upload."
        return st
    }

    // MARK: - Internals

    private static func uploadStorageObject(
        _ wav: Data,
        bucket: String,
        path: String,
        base: String,
        cfg: SupabaseConfig
    ) async throws {
        let encoded = path.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? path
        guard let storageURL = URL(string: "\(base)/storage/v1/object/\(bucket)/\(encoded)") else {
            throw ClientError.notConfigured
        }

        // Prefer POST; on conflict retry PUT with upsert.
        for method in ["POST", "PUT"] {
            var upReq = URLRequest(url: storageURL, timeoutInterval: 120)
            upReq.httpMethod = method
            var upHeaders = cfg.authHeaders(contentType: "audio/wav")
            upHeaders["x-upsert"] = "true"
            upHeaders.forEach { upReq.setValue($0.value, forHTTPHeaderField: $0.key) }
            upReq.httpBody = wav
            let (upData, upResp) = try await URLSession.shared.data(for: upReq)
            let code = (upResp as? HTTPURLResponse)?.statusCode ?? 0
            if code >= 200 && code < 300 { return }
            if method == "POST", code == 400 || code == 409 { continue }
            let body = String(data: upData, encoding: .utf8) ?? ""
            throw ClientError.http(code, String(body.prefix(240)))
        }
    }

    private static func insertSoundRow(
        _ row: [String: Any],
        base: String,
        cfg: SupabaseConfig
    ) async throws -> [String: Any] {
        guard let restURL = URL(string: "\(base)/rest/v1/sounds") else {
            throw ClientError.notConfigured
        }
        var insReq = URLRequest(url: restURL, timeoutInterval: 30)
        insReq.httpMethod = "POST"
        var insHeaders = cfg.authHeaders()
        insHeaders["Prefer"] = "return=representation"
        insHeaders.forEach { insReq.setValue($0.value, forHTTPHeaderField: $0.key) }
        insReq.httpBody = try JSONSerialization.data(withJSONObject: row)

        let (insData, insResp) = try await URLSession.shared.data(for: insReq)
        try throwIfHTTPError(insResp, data: insData)
        if let arr = try? JSONSerialization.jsonObject(with: insData) as? [[String: Any]], let first = arr.first {
            return first
        }
        if let dict = try? JSONSerialization.jsonObject(with: insData) as? [String: Any] {
            return dict
        }
        var out = row
        out["created_at"] = ISO8601DateFormatter().string(from: Date())
        return out
    }

    private static func deleteStorageObject(
        bucket: String,
        path: String,
        base: String,
        cfg: SupabaseConfig
    ) async throws {
        guard let url = URL(string: "\(base)/storage/v1/object/\(bucket)/\(path)") else { return }
        var req = URLRequest(url: url, timeoutInterval: 30)
        req.httpMethod = "DELETE"
        cfg.authHeaders().forEach { req.setValue($0.value, forHTTPHeaderField: $0.key) }
        let (data, resp) = try await URLSession.shared.data(for: req)
        let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
        // 404 = already gone
        if code >= 400 && code != 404 {
            let body = String(data: data, encoding: .utf8) ?? ""
            throw ClientError.http(code, String(body.prefix(200)))
        }
    }

    private static func throwIfHTTPError(_ resp: URLResponse?, data: Data) throws {
        let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
        if code >= 400 {
            let body = String(data: data, encoding: .utf8) ?? ""
            throw ClientError.http(code, String(body.prefix(240)))
        }
    }

    private static func failReport(_ steps: [[String: Any]], hint: String) -> [String: Any] {
        [
            "ok": false,
            "configured": true,
            "steps": steps,
            "hint": hint,
        ]
    }
}
