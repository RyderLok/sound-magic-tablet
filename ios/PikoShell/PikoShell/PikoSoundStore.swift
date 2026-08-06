import Foundation

/// Local Documents store — same row shape as python-service sounds list for syncIntoApp.
final class PikoSoundStore {
    static let shared = PikoSoundStore()

    private let queue = DispatchQueue(label: "com.piko.soundstore")
    private let fm = FileManager.default

    private var root: URL {
        let docs = fm.urls(for: .documentDirectory, in: .userDomainMask)[0]
        return docs.appendingPathComponent("piko-sounds", isDirectory: true)
    }

    private var indexURL: URL { root.appendingPathComponent("index.json") }

    private init() {
        try? fm.createDirectory(at: root, withIntermediateDirectories: true)
        if !fm.fileExists(atPath: indexURL.path) {
            writeIndex([])
        }
    }

    func backendStatus() -> [String: Any] {
        queue.sync {
            let rows = readIndexUnlocked()
            return [
                "configured": true,
                "backend": "ipad-local",
                "sourceOfTruth": "ipad-local",
                "localDir": root.path,
                "localCount": rows.count,
                "hint": "Sounds stored on this iPad. Mac Python path unchanged for desktop.",
            ]
        }
    }

    func listSounds(since: String?) -> [[String: Any]] {
        queue.sync {
            var rows = readIndexUnlocked()
            rows.sort { a, b in
                String(describing: a["created_at"] ?? "") > String(describing: b["created_at"] ?? "")
            }
            guard let since, !since.isEmpty else { return rows }
            return rows.filter { row in
                let created = String(describing: row["created_at"] ?? "")
                return !created.isEmpty && created >= since
            }
        }
    }

    func getSound(id: String) -> [String: Any]? {
        queue.sync {
            readIndexUnlocked().first { String(describing: $0["id"] ?? "") == id }
        }
    }

    /// Write WAV bytes for offline playback cache without changing cloud index semantics.
    func cacheAudioFile(id: String, data: Data) {
        queue.sync {
            try? fm.createDirectory(at: root, withIntermediateDirectories: true)
            let url = root.appendingPathComponent("\(id).wav")
            try? data.write(to: url, options: .atomic)
        }
    }

    func readAudio(id: String) -> Data? {
        queue.sync {
            let url = root.appendingPathComponent("\(id).wav")
            return try? Data(contentsOf: url)
        }
    }

    @discardableResult
    func saveWav(
        _ wav: Data,
        name: String?,
        durationMs: Int,
        sampleRate: Int,
        source: String,
        soundId: String? = nil,
        createdAt: String? = nil,
        storagePath: String? = nil
    ) throws -> [String: Any] {
        try queue.sync {
            try fm.createDirectory(at: root, withIntermediateDirectories: true)
            let id = (soundId?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false)
                ? soundId!.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
                : UUID().uuidString.lowercased()
            let wavURL = root.appendingPathComponent("\(id).wav")
            try wav.write(to: wavURL, options: .atomic)

            var rows = readIndexUnlocked().filter { String(describing: $0["id"] ?? "") != id }
            let nextName: String
            if let name, !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                nextName = name
            } else {
                nextName = "sound\(rows.count + 1)"
            }
            let iso = createdAt ?? isoNow()
            let row: [String: Any] = [
                "id": id,
                "created_at": iso,
                "name": nextName,
                "duration_ms": durationMs,
                "sample_rate": sampleRate,
                "upload_status": "uploaded",
                "storage_path": storagePath ?? "\(id).wav",
                "source": source,
                "analysis": NSNull(),
                "brush": NSNull(),
            ]
            rows.insert(row, at: 0)
            writeIndex(rows)
            return row
        }
    }

    private func readIndexUnlocked() -> [[String: Any]] {
        guard let data = try? Data(contentsOf: indexURL),
              let obj = try? JSONSerialization.jsonObject(with: data),
              let rows = obj as? [[String: Any]]
        else { return [] }
        return rows
    }

    private func writeIndex(_ rows: [[String: Any]]) {
        guard let data = try? JSONSerialization.data(withJSONObject: rows, options: [.prettyPrinted]) else { return }
        try? data.write(to: indexURL, options: .atomic)
    }

    private func isoNow() -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f.string(from: Date())
    }
}
