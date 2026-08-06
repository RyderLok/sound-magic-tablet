import Foundation

/// Lightweight PCM/WAV acoustics + category brush mapping (iPad; no librosa).
enum IpadAudioAnalysis {
    static let categoryToPattern: [String: String] = [
        "birds": "scatter_points",
        "wind_leaves": "flow_field",
        "water": "wave_ripple",
        "material_impact": "impact_burst",
        "insects_amphibians": "pulse_grid",
    ]

    private static let brushRanges: [String: [String: (Double, Double)]] = [
        "birds": [
            "brushSize": (0.22, 0.58), "density": (0.32, 0.92), "movementSpeed": (0.35, 0.88),
            "turbulence": (0.22, 0.78), "continuity": (0.12, 0.55), "trailLength": (0.10, 0.48),
            "spawnRate": (0.35, 0.95), "particleSize": (0.15, 0.55), "gapProbability": (0.25, 0.85),
        ],
        "wind_leaves": [
            "brushSize": (0.35, 0.82), "density": (0.28, 0.75), "movementSpeed": (0.20, 0.70),
            "turbulence": (0.25, 0.85), "continuity": (0.45, 0.92), "trailLength": (0.40, 0.90),
            "spawnRate": (0.25, 0.70), "particleSize": (0.25, 0.65), "gapProbability": (0.05, 0.40),
        ],
        "water": [
            "brushSize": (0.40, 0.90), "density": (0.38, 0.82), "movementSpeed": (0.18, 0.62),
            "turbulence": (0.10, 0.52), "continuity": (0.40, 0.95), "trailLength": (0.35, 0.92),
            "spawnRate": (0.30, 0.78), "particleSize": (0.30, 0.70), "gapProbability": (0.08, 0.55),
        ],
        "material_impact": [
            "brushSize": (0.28, 0.95), "density": (0.30, 0.80), "movementSpeed": (0.40, 0.95),
            "turbulence": (0.20, 0.75), "continuity": (0.08, 0.42), "trailLength": (0.08, 0.45),
            "spawnRate": (0.25, 0.90), "particleSize": (0.25, 0.75), "gapProbability": (0.35, 0.90),
        ],
        "insects_amphibians": [
            "brushSize": (0.20, 0.70), "density": (0.40, 0.95), "movementSpeed": (0.25, 0.75),
            "turbulence": (0.15, 0.65), "continuity": (0.20, 0.70), "trailLength": (0.15, 0.60),
            "spawnRate": (0.40, 0.98), "particleSize": (0.12, 0.60), "gapProbability": (0.15, 0.70),
        ],
    ]

    /// Returns FullAnalysis-shaped dict for web-demo pythonEnhancementClient.
    static func analyzeWav(_ wav: Data, category: String?) -> [String: Any] {
        let (pcm, sr) = extractPcm16(wav)
        let acoustic = computeAcoustic(pcm: pcm, sampleRate: sr)
        let features = featuresFromAcoustic(acoustic)
        let modifiers = modifiersFromFeatures(features)
        let brush = mapBrush(category: category, acoustic: acoustic)
        if let cat = category, let pattern = categoryToPattern[cat] {
            var b = brush
            b["strokePattern"] = pattern
            return pack(features: features, modifiers: modifiers, brush: b, acoustic: acoustic, category: cat)
        }
        return pack(features: features, modifiers: modifiers, brush: brush, acoustic: acoustic, category: category)
    }

    private static func pack(
        features: [String: Any],
        modifiers: [String: Any],
        brush: [String: Any],
        acoustic: [String: Double],
        category: String?
    ) -> [String: Any] {
        var export: [String: Any] = [
            "brushReady": true,
            "strokePattern": brush["strokePattern"] as Any,
            "category": category as Any,
            "engine": "ipad-lite",
        ]
        return [
            "features": features,
            "visualModifiers": modifiers,
            "brushParams": brush,
            "acoustic": acoustic,
            "analysisExport": export,
            "duration": acoustic["duration"] ?? 0,
        ]
    }

    private static func extractPcm16(_ wav: Data) -> (Data, Int) {
        // Minimal WAV parse: look for "data" chunk; assume 16-bit mono if unclear.
        var sampleRate = 16000
        if wav.count > 44 {
            // sample rate at offset 24 little-endian for standard PCM wav
            sampleRate = Int(wav[24]) | (Int(wav[25]) << 8) | (Int(wav[26]) << 16) | (Int(wav[27]) << 24)
            if sampleRate < 8000 || sampleRate > 96000 { sampleRate = 16000 }
        }
        if let range = wav.range(of: Data("data".utf8)) {
            let sizeStart = range.upperBound
            if sizeStart + 4 <= wav.count {
                let dataStart = sizeStart + 4
                return (wav.subdata(in: dataStart..<wav.count), sampleRate)
            }
        }
        if wav.count > 44 {
            return (wav.subdata(in: 44..<wav.count), sampleRate)
        }
        return (wav, sampleRate)
    }

    private static func computeAcoustic(pcm: Data, sampleRate: Int) -> [String: Double] {
        let n = pcm.count / 2
        guard n > 0 else {
            return ["duration": 0, "rms": 0, "peak": 0, "zcr": 0]
        }
        var sumSq: Double = 0
        var peak: Double = 0
        var zcrCount = 0
        var prev: Int16 = 0
        pcm.withUnsafeBytes { raw in
            let samples = raw.bindMemory(to: Int16.self)
            for i in 0..<n {
                let s = samples[i]
                let v = abs(Double(s)) / 32768.0
                sumSq += v * v
                if v > peak { peak = v }
                if i > 0 {
                    if (prev >= 0 && s < 0) || (prev < 0 && s >= 0) { zcrCount += 1 }
                }
                prev = s
            }
        }
        let rms = sqrt(sumSq / Double(n))
        let duration = Double(n) / Double(max(1, sampleRate))
        let zcr = min(1, Double(zcrCount) / Double(max(1, n)))
        // Crude proxies without FFT — enough to drive within-class brush ranges.
        let brightness = clamp01(zcr * 1.4)
        let bass = clamp01(1.0 - brightness)
        let silence = clamp01(1.0 - rms * 2.5)
        return [
            "duration": duration,
            "rms": clamp01(rms * 2.2),
            "peak": clamp01(peak),
            "zcr": zcr,
            "spectralCentroid": brightness,
            "bassRatio": bass,
            "midRatio": 0.45,
            "trebleRatio": brightness,
            "spectralFlatness": clamp01(zcr * 0.8 + rms * 0.2),
            "roughness": clamp01(zcr * 0.6 + peak * 0.3),
            "spectralFlux": clamp01(peak * 0.5 + zcr * 0.3),
            "tempo": clamp01(zcr * 0.7),
            "onsetDensity": clamp01(peak * 0.6 + zcr * 0.3),
            "pulseRegularity": clamp01(0.4 + (1.0 - zcr) * 0.3),
            "continuity": clamp01(1.0 - silence),
            "silenceRatio": silence,
            "eventDuration": clamp01(min(1, duration / 8.0)),
        ]
    }

    private static func featuresFromAcoustic(_ a: [String: Double]) -> [String: Any] {
        [
            "volume": a["rms"] ?? 0,
            "energy": a["rms"] ?? 0,
            "brightness": a["spectralCentroid"] ?? 0,
            "roughness": a["roughness"] ?? 0,
            "pitch": a["spectralCentroid"] ?? 0,
            "tempo": a["tempo"] ?? 0,
            "spectralCentroid": a["spectralCentroid"] ?? 0,
            "zcr": a["zcr"] ?? 0,
            "dynamicRange": a["peak"] ?? 0,
            "spectralVariation": a["spectralFlux"] ?? 0,
            "bass": a["bassRatio"] ?? 0,
            "mid": a["midRatio"] ?? 0,
            "treble": a["trebleRatio"] ?? 0,
            "spectrumProfile": [] as [Double],
        ]
    }

    private static func modifiersFromFeatures(_ f: [String: Any]) -> [String: Any] {
        let vol = clamp01(double(f["volume"]))
        let bright = clamp01(double(f["brightness"]))
        let rough = clamp01(double(f["roughness"]))
        return [
            "motionIntensity": clamp01(vol * 0.6 + bright * 0.4),
            "turbulence": rough,
            "strokeComplexity": clamp01(bright * 0.5 + rough * 0.5),
            "particleDensity": clamp01(vol * 0.5 + bright * 0.3),
            "smoothness": clamp01(1 - rough),
            "organicFactor": 0.55,
            "flowSpeed": clamp01(bright * 0.5 + vol * 0.3),
            "spread": clamp01(vol),
            "continuity": clamp01(1 - double(f["zcr"])),
            "pulseStrength": clamp01(double(f["tempo"])),
            "rotationSpeed": clamp01(bright * 0.4),
            "scaleResponse": clamp01(vol),
        ]
    }

    private static func mapBrush(category: String?, acoustic: [String: Double]) -> [String: Any] {
        let rangeCat = (category.flatMap { brushRanges[$0] != nil ? $0 : nil }) ?? "wind_leaves"
        let rms = acoustic["rms"] ?? 0
        let peak = acoustic["peak"] ?? 0
        let sc = acoustic["spectralCentroid"] ?? 0
        let rough = acoustic["roughness"] ?? 0
        let tempo = acoustic["tempo"] ?? 0
        let silence = acoustic["silenceRatio"] ?? 0
        let continuity = acoustic["continuity"] ?? 0

        func ir(_ key: String, _ t: Double) -> Double {
            let r = brushRanges[rangeCat]?[key] ?? (0.15, 0.85)
            return round4(r.0 + (r.1 - r.0) * clamp01(t))
        }

        var brush: [String: Any] = [
            "brushSize": ir("brushSize", rms * 0.75 + peak * 0.25),
            "density": ir("density", tempo * 0.5 + sc * 0.3),
            "movementSpeed": ir("movementSpeed", sc * 0.5 + tempo * 0.3),
            "turbulence": ir("turbulence", rough),
            "continuity": ir("continuity", continuity),
            "trailLength": ir("trailLength", continuity),
            "spawnRate": ir("spawnRate", tempo * 0.6 + (1 - silence) * 0.3),
            "particleSize": ir("particleSize", 1 - sc),
            "gapProbability": ir("gapProbability", silence),
            "strokeWidth": ir("brushSize", rms),
            "flow": clamp01(continuity),
            "motion": clamp01(sc),
            "smoothness": clamp01(1 - rough),
            "vibrationAmplitude": clamp01(rough),
            "vibrationFrequency": clamp01(tempo),
            "vibrationRandomness": clamp01(rough * 0.5),
            "styleModifiers": [:] as [String: Any],
        ]
        if let cat = category, let pattern = categoryToPattern[cat] {
            brush["strokePattern"] = pattern
        }
        return brush
    }

    private static func clamp01(_ v: Double) -> Double { min(1, max(0, v)) }
    private static func round4(_ v: Double) -> Double { (v * 10000).rounded() / 10000 }
    private static func double(_ v: Any?) -> Double {
        if let d = v as? Double { return d }
        if let n = v as? NSNumber { return n.doubleValue }
        return Double(String(describing: v ?? "0")) ?? 0
    }
}
