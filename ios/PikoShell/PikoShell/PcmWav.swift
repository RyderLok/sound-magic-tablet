import Foundation

enum PcmWav {
    /// Wrap raw mono PCM16 little-endian as a WAV blob (matches python-service `_pcm16le_to_wav`).
    static func pcm16leToWav(_ pcm: Data, sampleRate: Int) -> Data {
        let sr = max(8000, sampleRate)
        var data = pcm
        if data.count % 2 == 1 {
            data = data.dropLast()
        }
        let dataSize = UInt32(data.count)
        let byteRate = UInt32(sr * 2)
        let blockAlign: UInt16 = 2
        let bits: UInt16 = 16
        let riffSize = UInt32(36) + dataSize

        var header = Data()
        header.append(contentsOf: Array("RIFF".utf8))
        header.append(uint32LE(riffSize))
        header.append(contentsOf: Array("WAVE".utf8))
        header.append(contentsOf: Array("fmt ".utf8))
        header.append(uint32LE(16))
        header.append(uint16LE(1)) // PCM
        header.append(uint16LE(1)) // mono
        header.append(uint32LE(UInt32(sr)))
        header.append(uint32LE(byteRate))
        header.append(uint16LE(blockAlign))
        header.append(uint16LE(bits))
        header.append(contentsOf: Array("data".utf8))
        header.append(uint32LE(dataSize))
        header.append(data)
        return header
    }

    private static func uint16LE(_ v: UInt16) -> Data {
        var le = v.littleEndian
        return Data(bytes: &le, count: 2)
    }

    private static func uint32LE(_ v: UInt32) -> Data {
        var le = v.littleEndian
        return Data(bytes: &le, count: 4)
    }
}
