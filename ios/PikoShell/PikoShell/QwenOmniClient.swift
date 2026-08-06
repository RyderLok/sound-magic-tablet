import Foundation

/// SiliconFlow Qwen3-Omni — same 5-class grayscale contract as python-service/siliconflow_omni.py
enum QwenOmniClient {
    static let archetypeIds: Set<String> = [
        "birds", "wind_leaves", "water", "material_impact", "insects_amphibians",
    ]
    static let labelsZh: [String: String] = [
        "birds": "鸟类",
        "wind_leaves": "风与树叶",
        "water": "水",
        "material_impact": "自然材质交互",
        "insects_amphibians": "昆虫与两栖动物",
    ]

    private static let prompt = """
    你在做灰度测试：请把这段自然声录音归入下列五类之一（必须选一类）。
    birds — 鸟鸣、啾啾、间歇短脉冲、静音多
    wind_leaves — 风声、树叶沙沙、连续噪声纹理
    water — 流水、滴水、浪花、柔和起伏
    material_impact — 敲击、碰撞、折断、突发冲击后衰减
    insects_amphibians — 虫鸣、蝉鸣、蛙叫、规律重复脉冲
    若混合声，选最突出的一类；不确定时仍选最接近的一类并降低 confidence。
    只返回 JSON，不要 markdown，不要其它文字：
    {
      "archetype": "birds|wind_leaves|water|material_impact|insects_amphibians",
      "soundLabel": "与该类对应的短标签（可用中文）",
      "description": "对听到内容的客观描述",
      "possibleSources": ["可能的声源1", "可能的声源2"],
      "audibleEvents": ["可听事件1", "可听事件2"],
      "confidence": 0.0
    }
    confidence 为 0~1。
    """

    static func analyzeSemantic(wav: Data) async -> (semantic: [String: Any]?, error: [String: String]?) {
        guard !wav.isEmpty else {
            return (nil, ["code": "empty_audio", "message": "声音识别失败，请重试"])
        }
        let cfg = SiliconFlowConfig.shared
        guard cfg.isConfigured else {
            return (nil, ["code": "not_configured", "message": "声音识别失败，请重试", "detail": "Set SiliconFlow API key in Settings"])
        }

        let b64 = wav.base64EncodedString()
        let dataURL = "data:audio/wav;base64," + b64
        let body: [String: Any] = [
            "model": cfg.modelName,
            "messages": [
                [
                    "role": "system",
                    "content": "你是自然声音五类分类助手（灰度测试）。只能输出 JSON，archetype 必须是五类之一。",
                ],
                [
                    "role": "user",
                    "content": [
                        ["type": "audio_url", "audio_url": ["url": dataURL]],
                        ["type": "text", "text": prompt],
                    ] as [[String: Any]],
                ],
            ],
            "temperature": 0.2,
            "max_tokens": 512,
        ]

        guard let url = URL(string: "\(cfg.normalizedBase)/chat/completions"),
              let payload = try? JSONSerialization.data(withJSONObject: body)
        else {
            return (nil, ["code": "exception", "message": "声音识别失败，请重试"])
        }

        var req = URLRequest(url: url, timeoutInterval: 90)
        req.httpMethod = "POST"
        req.setValue("Bearer \(cfg.apiKey.trimmingCharacters(in: .whitespacesAndNewlines))", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = payload

        do {
            let (data, resp) = try await URLSession.shared.data(for: req)
            let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
            if code >= 400 {
                return (nil, ["code": "http_error", "message": "声音识别失败，请重试", "detail": "status_\(code)"])
            }
            guard let raw = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let choices = raw["choices"] as? [[String: Any]],
                  let message = choices.first?["message"] as? [String: Any],
                  let text = message["content"] as? String
            else {
                return (nil, ["code": "invalid_response", "message": "声音识别失败，请重试"])
            }
            guard let parsed = parseJSONContent(text),
                  var normalized = normalize(parsed)
            else {
                return (nil, ["code": "invalid_response", "message": "声音识别失败，请重试"])
            }
            normalized["model"] = cfg.modelName
            normalized["provider"] = "siliconflow"
            return (normalized, nil)
        } catch let err as URLError where err.code == .timedOut {
            return (nil, ["code": "timeout", "message": "声音识别失败，请重试"])
        } catch {
            return (nil, ["code": "network_error", "message": "声音识别失败，请重试", "detail": String(describing: type(of: error))])
        }
    }

    private static func normalize(_ parsed: [String: Any]) -> [String: Any]? {
        var rawArch = String(describing: parsed["archetype"] ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
            .replacingOccurrences(of: "-", with: "_")
            .replacingOccurrences(of: " ", with: "_")
        let aliases: [String: String] = [
            "bird": "birds", "wind": "wind_leaves", "leaves": "wind_leaves", "leaf": "wind_leaves",
            "impact": "material_impact", "material": "material_impact",
            "insect": "insects_amphibians", "insects": "insects_amphibians",
            "amphibian": "insects_amphibians", "amphibians": "insects_amphibians",
        ]
        if let a = aliases[rawArch] { rawArch = a }
        guard archetypeIds.contains(rawArch) else { return nil }

        var label = String(describing: parsed["soundLabel"] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        var description = String(describing: parsed["description"] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if label.isEmpty { label = labelsZh[rawArch] ?? rawArch }
        if description.isEmpty { description = label }
        let conf = min(1, max(0, Double(String(describing: parsed["confidence"] ?? "0.5")) ?? 0.5))

        return [
            "archetype": rawArch,
            "archetypeLabelZh": labelsZh[rawArch] ?? rawArch,
            "soundLabel": String(label.prefix(120)),
            "description": String(description.prefix(800)),
            "possibleSources": asStrList(parsed["possibleSources"]),
            "audibleEvents": asStrList(parsed["audibleEvents"]),
            "confidence": (conf * 1000).rounded() / 1000,
        ]
    }

    private static func asStrList(_ value: Any?) -> [String] {
        if let s = value as? String {
            let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
            return t.isEmpty ? [] : [String(t.prefix(160))]
        }
        if let arr = value as? [Any] {
            return arr.compactMap { item -> String? in
                let s = String(describing: item).trimmingCharacters(in: .whitespacesAndNewlines)
                return s.isEmpty ? nil : String(s.prefix(160))
            }
        }
        return []
    }

    private static func parseJSONContent(_ text: String) -> [String: Any]? {
        var cleaned = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if let range = cleaned.range(of: "```(?:json)?\\s*([\\s\\S]*?)```", options: .regularExpression) {
            let inner = String(cleaned[range])
            if let m = inner.range(of: "\\{[\\s\\S]*\\}", options: .regularExpression) {
                cleaned = String(inner[m])
            }
        }
        if let data = cleaned.data(using: .utf8),
           let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            return obj
        }
        if let m = cleaned.range(of: "\\{[\\s\\S]*\\}", options: .regularExpression),
           let data = String(cleaned[m]).data(using: .utf8),
           let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            return obj
        }
        return nil
    }
}
