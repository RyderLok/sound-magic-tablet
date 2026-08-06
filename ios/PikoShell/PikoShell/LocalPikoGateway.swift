import Foundation
import Network

/// Minimal HTTP/1.1 gateway on :8001 — same contract as python-service for ESP + web-demo.
/// Binds 0.0.0.0 so ESP32 on the phone hotspot can POST /sounds/upload_pcm.
final class LocalPikoGateway {
    static let shared = LocalPikoGateway()

    static let port: UInt16 = 8001

    private var listener: NWListener?
    private let store = PikoSoundStore.shared
    private let stateQueue = DispatchQueue(label: "com.piko.gateway.state")
    private var esp32Announce: [String: Any] = [:]
    private(set) var isRunning = false
    private(set) var lastError: String?

    private init() {}

    func start() {
        stateQueue.sync {
            guard listener == nil else { return }
            do {
                let params = NWParameters.tcp
                params.allowLocalEndpointReuse = true
                let listener = try NWListener(using: params, on: NWEndpoint.Port(rawValue: Self.port)!)
                listener.newConnectionHandler = { [weak self] conn in
                    self?.handle(connection: conn)
                }
                listener.stateUpdateHandler = { [weak self] state in
                    switch state {
                    case .ready:
                        self?.isRunning = true
                        self?.lastError = nil
                        print("[piko-gateway] listening on 0.0.0.0:\(Self.port)")
                    case .failed(let err):
                        self?.isRunning = false
                        self?.lastError = err.localizedDescription
                        print("[piko-gateway] failed: \(err)")
                    default:
                        break
                    }
                }
                listener.start(queue: DispatchQueue.global(qos: .userInitiated))
                self.listener = listener
            } catch {
                lastError = error.localizedDescription
                print("[piko-gateway] start error: \(error)")
            }
        }
    }

    func stop() {
        stateQueue.sync {
            listener?.cancel()
            listener = nil
            isRunning = false
        }
    }

    // MARK: - Connection

    private func handle(connection: NWConnection) {
        connection.start(queue: DispatchQueue.global(qos: .userInitiated))
        receiveRequest(on: connection, buffer: Data())
    }

    private func receiveRequest(on connection: NWConnection, buffer: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 256 * 1024) { [weak self] data, _, isComplete, error in
            guard let self else { return }
            if let error {
                print("[piko-gateway] recv error: \(error)")
                connection.cancel()
                return
            }
            var buf = buffer
            if let data, !data.isEmpty {
                buf.append(data)
            }

            if let headerEnd = Self.findHeaderEnd(buf) {
                let headerData = buf.subdata(in: 0..<headerEnd)
                var body = buf.subdata(in: headerEnd..<buf.count)
                guard let headerText = String(data: headerData, encoding: .utf8) else {
                    self.sendHTTP(connection, status: 400, body: Data("bad request".utf8), contentType: "text/plain")
                    return
                }
                let lines = headerText.split(separator: "\r\n", omittingEmptySubsequences: false).map(String.init)
                guard let requestLine = lines.first else {
                    self.sendHTTP(connection, status: 400, body: Data("bad request".utf8), contentType: "text/plain")
                    return
                }
                let parts = requestLine.split(separator: " ")
                guard parts.count >= 2 else {
                    self.sendHTTP(connection, status: 400, body: Data("bad request".utf8), contentType: "text/plain")
                    return
                }
                let method = String(parts[0]).uppercased()
                let target = String(parts[1])
                var headers: [String: String] = [:]
                for line in lines.dropFirst() {
                    if line.isEmpty { break }
                    if let idx = line.firstIndex(of: ":") {
                        let key = String(line[..<idx]).trimmingCharacters(in: .whitespaces).lowercased()
                        let val = String(line[line.index(after: idx)...]).trimmingCharacters(in: .whitespaces)
                        headers[key] = val
                    }
                }
                let contentLength = Int(headers["content-length"] ?? "0") ?? 0

                func finish(_ fullBody: Data) {
                    self.dispatch(
                        connection: connection,
                        method: method,
                        target: target,
                        body: fullBody,
                        contentType: headers["content-type"]
                    )
                }

                if body.count >= contentLength {
                    if body.count > contentLength {
                        body = body.subdata(in: 0..<contentLength)
                    }
                    finish(body)
                } else {
                    self.receiveBody(
                        on: connection,
                        existing: body,
                        remaining: contentLength - body.count,
                        then: finish
                    )
                }
                return
            }

            if isComplete {
                connection.cancel()
                return
            }
            // Keep reading headers (cap ~1MB headers+partial)
            if buf.count > 1024 * 1024 {
                self.sendHTTP(connection, status: 413, body: Data("headers too large".utf8), contentType: "text/plain")
                return
            }
            self.receiveRequest(on: connection, buffer: buf)
        }
    }

    private func receiveBody(
        on connection: NWConnection,
        existing: Data,
        remaining: Int,
        then: @escaping (Data) -> Void
    ) {
        if remaining <= 0 {
            then(existing)
            return
        }
        connection.receive(minimumIncompleteLength: 1, maximumLength: min(remaining, 512 * 1024)) { [weak self] data, _, isComplete, error in
            guard let self else { return }
            if let error {
                print("[piko-gateway] body error: \(error)")
                connection.cancel()
                return
            }
            var buf = existing
            if let data, !data.isEmpty {
                buf.append(data)
            }
            let still = remaining - (data?.count ?? 0)
            if still <= 0 || isComplete {
                then(buf)
            } else {
                self.receiveBody(on: connection, existing: buf, remaining: still, then: then)
            }
        }
    }

    private static func findHeaderEnd(_ data: Data) -> Int? {
        let pattern = Data([0x0d, 0x0a, 0x0d, 0x0a])
        return data.range(of: pattern).map { $0.upperBound }
    }

    // MARK: - Routing

    private func dispatch(
        connection: NWConnection,
        method: String,
        target: String,
        body: Data,
        contentType: String?
    ) {
        let (path, query) = Self.splitTarget(target)

        if method == "OPTIONS" {
            sendHTTP(connection, status: 204, body: Data(), contentType: "text/plain")
            return
        }

        switch (method, path) {
        case ("GET", "/health"), ("GET", "/health/"):
            sendJSON(connection, [
                "status": "ok",
                "http": "http://127.0.0.1:\(Self.port)",
                "backend": SupabaseConfig.shared.isConfigured ? "ipad-supabase" : "ipad-local",
                "supabase": SupabaseSoundsClient.backendStatus(),
                "omni": SiliconFlowConfig.shared.status(),
                "endpoints": [
                    "analyzeWav": "http://127.0.0.1:\(Self.port)/analyze/wav",
                    "soundsUploadPcm": "http://127.0.0.1:\(Self.port)/sounds/upload_pcm",
                ],
                "wifiUpload": [
                    "path": "/sounds/upload_pcm",
                    "hint": "ESP32 STA POST raw PCM16 LE to this iPad :\(Self.port)",
                ] as [String: String],
                "lanHint": LanAddress.uploadHint(port: Self.port),
            ] as [String: Any])

        case ("POST", "/sounds/upload_pcm"), ("POST", "/sounds/upload_pcm/"):
            handleUploadPcm(connection, query: query, body: body)

        case ("POST", "/analyze/wav"), ("POST", "/analyze/wav/"):
            handleAnalyzeWav(connection, body: body, contentType: contentType)

        case ("GET", "/sounds"), ("GET", "/sounds/"):
            handleListSounds(connection, query: query)

        case ("GET", "/supabase/selftest"), ("POST", "/supabase/selftest"),
             ("GET", "/supabase/selftest/"), ("POST", "/supabase/selftest/"):
            handleSupabaseSelfTest(connection)

        case ("POST", "/esp32/announce"), ("POST", "/esp32/announce/"):
            handleAnnounce(connection, body: body)

        case ("GET", "/esp32"), ("GET", "/esp32/"):
            let ann = stateQueue.sync { esp32Announce }
            if ann.isEmpty {
                sendJSON(connection, ["status": "missing", "esp32": NSNull()] as [String: Any])
            } else {
                sendJSON(connection, ["status": "ok", "esp32": ann] as [String: Any])
            }

        case ("GET", "/esp32/metrics"), ("GET", "/esp32/metrics/"):
            proxyEsp32(connection, path: "/metrics", method: "GET", body: nil)

        default:
            if method == "POST", path.hasPrefix("/esp32/record/") {
                let action = path
                    .replacingOccurrences(of: "/esp32/record/", with: "")
                    .trimmingCharacters(in: CharacterSet(charactersIn: "/"))
                    .lowercased()
                if action == "start" || action == "stop" {
                    proxyEsp32(connection, path: "/record/\(action)", method: "POST", body: Data())
                    return
                }
            }

            if method == "GET", path.hasPrefix("/sounds/") {
                let rest = String(path.dropFirst("/sounds/".count))
                let parts = rest.split(separator: "/").map(String.init)
                if parts.count == 1 {
                    handleGetSound(connection, id: parts[0])
                    return
                }
                if parts.count == 2, parts[1] == "audio" {
                    handleAudio(connection, id: parts[0])
                    return
                }
            }

            if method == "POST", path == "/analyze/wav" || path == "/analyze/wav/" {
                handleAnalyzeWav(connection, body: body, contentType: contentType)
                return
            }

            if method == "GET" {
                serveStatic(connection, path: path)
                return
            }

            sendJSON(connection, ["detail": "Not found"] as [String: Any], status: 404)
        }
    }

    private func handleAnalyzeWav(_ connection: NWConnection, body: Data, contentType: String?) {
        var wav = MultipartForm.extractFile(body: body, contentType: contentType)
        if wav == nil, body.count > 44, body.starts(with: Data("RIFF".utf8)) {
            wav = body
        }
        guard let wav, wav.count > 44 else {
            sendJSON(connection, ["detail": "WAV file required (multipart field file)"] as [String: Any], status: 400)
            return
        }

        Task {
            let (semantic, semanticError) = await QwenOmniClient.analyzeSemantic(wav: wav)
            let category = (semantic?["archetype"] as? String)
            var result = IpadAudioAnalysis.analyzeWav(wav, category: category)
            if let semantic {
                result["semantic"] = semantic
                result["semanticError"] = NSNull()
            } else if let semanticError {
                result["semantic"] = NSNull()
                result["semanticError"] = semanticError
            } else {
                result["semantic"] = NSNull()
                result["semanticError"] = NSNull()
            }
            sendJSON(connection, result)
            print("[piko-gateway] analyze/wav done semantic=\(semantic != nil) category=\(category ?? "nil")")
        }
    }

    private func handleGetSound(_ connection: NWConnection, id: String) {
        if let row = store.getSound(id: id) {
            sendJSON(connection, ["status": "ok", "sound": row] as [String: Any])
            return
        }
        guard SupabaseConfig.shared.isConfigured else {
            sendJSON(connection, ["detail": "Sound not found"] as [String: Any], status: 404)
            return
        }
        Task {
            do {
                if let row = try await SupabaseSoundsClient.getSound(id: id) {
                    sendJSON(connection, ["status": "ok", "sound": row] as [String: Any])
                } else {
                    sendJSON(connection, ["detail": "Sound not found"] as [String: Any], status: 404)
                }
            } catch {
                sendJSON(connection, ["detail": error.localizedDescription] as [String: Any], status: 502)
            }
        }
    }

    private func handleSupabaseSelfTest(_ connection: NWConnection) {
        Task {
            let report = await SupabaseSoundsClient.selfTest()
            let ok = (report["ok"] as? Bool) == true
            let hint = report["hint"] as? String ?? ""
            await MainActor.run {
                SupabaseConfig.shared.lastSelfTestSummary = ok ? "OK \(hint)" : "FAIL \(hint)"
            }
            sendJSON(connection, report, status: ok ? 200 : 502)
        }
    }

    private func handleListSounds(_ connection: NWConnection, query: [String: String]) {
        let since = query["since"] ?? ""
        if SupabaseConfig.shared.isConfigured {
            Task {
                do {
                    let rows = try await SupabaseSoundsClient.listSounds(since: since.isEmpty ? nil : since)
                    sendJSON(connection, [
                        "status": "ok",
                        "sounds": rows,
                        "backend": SupabaseSoundsClient.backendStatus(),
                        "since": since.isEmpty ? NSNull() : since,
                    ] as [String: Any])
                } catch {
                    sendJSON(connection, [
                        "status": "ok",
                        "sounds": store.listSounds(since: since.isEmpty ? nil : since),
                        "backend": store.backendStatus(),
                        "since": since.isEmpty ? NSNull() : since,
                        "warning": error.localizedDescription,
                    ] as [String: Any])
                }
            }
            return
        }
        sendJSON(connection, [
            "status": "ok",
            "sounds": store.listSounds(since: since.isEmpty ? nil : since),
            "backend": store.backendStatus(),
            "since": since.isEmpty ? NSNull() : since,
        ] as [String: Any])
    }

    private func handleAudio(_ connection: NWConnection, id: String) {
        if let blob = store.readAudio(id: id) {
            sendHTTP(connection, status: 200, body: blob, contentType: "audio/wav")
            return
        }
        guard SupabaseConfig.shared.isConfigured else {
            sendJSON(connection, ["detail": "Audio not found"] as [String: Any], status: 404)
            return
        }
        Task {
            do {
                var path = "\(id).wav"
                if let row = try await SupabaseSoundsClient.getSound(id: id),
                   let sp = row["storage_path"] as? String, !sp.isEmpty {
                    path = sp
                }
                let blob = try await SupabaseSoundsClient.downloadAudio(storagePath: path)
                store.cacheAudioFile(id: id, data: blob)
                sendHTTP(connection, status: 200, body: blob, contentType: "audio/wav")
            } catch {
                sendJSON(connection, ["detail": error.localizedDescription] as [String: Any], status: 404)
            }
        }
    }

    private func handleUploadPcm(_ connection: NWConnection, query: [String: String], body: Data) {
        var pcm = body
        if pcm.count < 256 {
            sendJSON(connection, ["detail": "PCM too small"] as [String: Any], status: 400)
            return
        }
        if pcm.count % 2 == 1 {
            pcm = pcm.dropLast()
        }
        let sr = max(8000, Int(query["sample_rate"] ?? "16000") ?? 16000)
        let source = (query["source"]?.isEmpty == false ? query["source"]! : "esp32-wifi")
        let name = query["name"]
        let durationMs = Int(round(1000.0 * Double(pcm.count / 2) / Double(sr)))
        let wav = PcmWav.pcm16leToWav(pcm, sampleRate: sr)

        if SupabaseConfig.shared.isConfigured {
            Task {
                do {
                    let row = try await SupabaseSoundsClient.uploadWav(
                        wav,
                        name: name,
                        durationMs: durationMs,
                        sampleRate: sr,
                        source: source
                    )
                    let sid = String(describing: row["id"] ?? "")
                    let created = row["created_at"] as? String
                    let sp = row["storage_path"] as? String
                    _ = try? store.saveWav(
                        wav,
                        name: row["name"] as? String ?? name,
                        durationMs: durationMs,
                        sampleRate: sr,
                        source: source,
                        soundId: sid.isEmpty ? nil : sid,
                        createdAt: created,
                        storagePath: sp
                    )
                    sendJSON(connection, [
                        "status": "ok",
                        "sound": row,
                        "duration_ms": durationMs,
                        "pcm_bytes": pcm.count,
                        "backend": "supabase",
                    ] as [String: Any])
                    print("[piko-gateway] upload_pcm → Supabase ok bytes=\(pcm.count)")
                } catch {
                    print("[piko-gateway] Supabase upload failed: \(error)")
                    sendJSON(connection, [
                        "detail": error.localizedDescription,
                        "hint": "Check Settings Supabase URL + anon key, and run anon INSERT policies in supabase_sounds.sql",
                    ] as [String: Any], status: 502)
                }
            }
            return
        }

        do {
            let row = try store.saveWav(wav, name: name, durationMs: durationMs, sampleRate: sr, source: source)
            sendJSON(connection, [
                "status": "ok",
                "sound": row,
                "duration_ms": durationMs,
                "pcm_bytes": pcm.count,
                "backend": "ipad-local",
            ] as [String: Any])
            print("[piko-gateway] upload_pcm local ok bytes=\(pcm.count) (Supabase not configured)")
        } catch {
            sendJSON(connection, ["detail": error.localizedDescription] as [String: Any], status: 502)
        }
    }

    private func handleAnnounce(_ connection: NWConnection, body: Data) {
        var ip = ""
        var port = 8080
        var recording = false
        if let obj = try? JSONSerialization.jsonObject(with: body) as? [String: Any] {
            ip = String(describing: obj["ip"] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            if let p = obj["port"] as? Int { port = p }
            else if let p = obj["port"] as? String, let n = Int(p) { port = n }
            recording = (obj["recording"] as? Bool) ?? false
        }
        guard !ip.isEmpty else {
            sendJSON(connection, ["detail": "ip required"] as [String: Any], status: 400)
            return
        }
        let base = "http://\(ip):\(port)"
        let ann: [String: Any] = [
            "ip": ip,
            "port": port,
            "base": base,
            "recording": recording,
            "updatedAt": Date().timeIntervalSince1970,
        ]
        stateQueue.sync { esp32Announce = ann }
        sendJSON(connection, ["status": "ok", "esp32": ann] as [String: Any])
    }

    private func proxyEsp32(_ connection: NWConnection, path: String, method: String, body: Data?) {
        let ann = stateQueue.sync { esp32Announce }
        guard let base = ann["base"] as? String, !base.isEmpty else {
            sendJSON(connection, ["detail": "ESP32 not announced yet"] as [String: Any], status: 404)
            return
        }
        guard let url = URL(string: base.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + path) else {
            sendJSON(connection, ["detail": "bad esp32 base"] as [String: Any], status: 502)
            return
        }
        var req = URLRequest(url: url, timeoutInterval: 3.0)
        req.httpMethod = method
        if let body { req.httpBody = body }
        URLSession.shared.dataTask(with: req) { [weak self] data, resp, err in
            guard let self else { return }
            if let err {
                self.sendJSON(connection, ["detail": err.localizedDescription] as [String: Any], status: 502)
                return
            }
            let code = (resp as? HTTPURLResponse)?.statusCode ?? 502
            let payload = data ?? Data()
            let ctype = (resp as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Type") ?? "application/json"
            if path.hasPrefix("/record/") {
                var result: Any = [String: Any]()
                if let obj = try? JSONSerialization.jsonObject(with: payload) {
                    result = obj
                } else if let s = String(data: payload, encoding: .utf8) {
                    result = ["ok": true, "raw": s] as [String: Any]
                }
                self.sendJSON(connection, [
                    "status": code >= 200 && code < 300 ? "ok" : "error",
                    "esp32": ann,
                    "result": result,
                ] as [String: Any], status: code >= 200 && code < 300 ? 200 : 502)
            } else {
                self.sendHTTP(connection, status: code, body: payload, contentType: ctype)
            }
        }.resume()
    }

    // MARK: - Static web-demo

    private func serveStatic(_ connection: NWConnection, path: String) {
        var rel = path
        if rel == "/" || rel.isEmpty { rel = "/index.html" }
        if rel.hasPrefix("/") { rel = String(rel.dropFirst()) }
        if rel.contains("..") {
            sendJSON(connection, ["detail": "Forbidden"] as [String: Any], status: 403)
            return
        }

        let bundle = Bundle.main
        let candidates: [URL?] = [
            bundle.url(forResource: (rel as NSString).deletingPathExtension,
                       withExtension: (rel as NSString).pathExtension,
                       subdirectory: "WebDemo"),
            bundle.resourceURL?.appendingPathComponent("WebDemo").appendingPathComponent(rel),
        ]
        guard let fileURL = candidates.compactMap({ $0 }).first(where: { FileManager.default.fileExists(atPath: $0.path) }),
              let data = try? Data(contentsOf: fileURL)
        else {
            sendJSON(connection, ["detail": "Not found", "path": rel] as [String: Any], status: 404)
            return
        }
        sendHTTP(connection, status: 200, body: data, contentType: Self.mimeType(for: rel))
    }

    private static func mimeType(for path: String) -> String {
        let ext = (path as NSString).pathExtension.lowercased()
        switch ext {
        case "html", "htm": return "text/html; charset=utf-8"
        case "js": return "application/javascript; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "json": return "application/json"
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "svg": return "image/svg+xml"
        case "wav": return "audio/wav"
        case "ico": return "image/x-icon"
        default: return "application/octet-stream"
        }
    }

    // MARK: - Response helpers

    private func sendJSON(_ connection: NWConnection, _ obj: [String: Any], status: Int = 200) {
        let data = (try? JSONSerialization.data(withJSONObject: obj)) ?? Data("{}".utf8)
        sendHTTP(connection, status: status, body: data, contentType: "application/json")
    }

    private func sendHTTP(
        _ connection: NWConnection,
        status: Int,
        body: Data,
        contentType: String
    ) {
        let reason: String
        switch status {
        case 200: reason = "OK"
        case 204: reason = "No Content"
        case 400: reason = "Bad Request"
        case 403: reason = "Forbidden"
        case 404: reason = "Not Found"
        case 413: reason = "Payload Too Large"
        case 501: reason = "Not Implemented"
        case 502: reason = "Bad Gateway"
        default: reason = "OK"
        }
        var head = "HTTP/1.1 \(status) \(reason)\r\n"
        head += "Content-Type: \(contentType)\r\n"
        head += "Content-Length: \(body.count)\r\n"
        head += "Access-Control-Allow-Origin: *\r\n"
        head += "Access-Control-Allow-Methods: GET, POST, OPTIONS, PATCH, DELETE\r\n"
        head += "Access-Control-Allow-Headers: Content-Type\r\n"
        head += "Cache-Control: no-store\r\n"
        head += "Connection: close\r\n"
        head += "\r\n"
        var packet = Data(head.utf8)
        packet.append(body)
        connection.send(content: packet, completion: .contentProcessed { _ in
            connection.cancel()
        })
    }

    private static func splitTarget(_ target: String) -> (String, [String: String]) {
        guard let qIdx = target.firstIndex(of: "?") else {
            return (target, [:])
        }
        let path = String(target[..<qIdx])
        let qs = String(target[target.index(after: qIdx)...])
        var query: [String: String] = [:]
        for pair in qs.split(separator: "&") {
            let kv = pair.split(separator: "=", maxSplits: 1).map(String.init)
            if kv.count == 2 {
                query[kv[0]] = kv[1].removingPercentEncoding ?? kv[1]
            } else if kv.count == 1 {
                query[kv[0]] = ""
            }
        }
        return (path, query)
    }
}
