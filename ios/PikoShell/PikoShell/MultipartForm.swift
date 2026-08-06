import Foundation

enum MultipartForm {
    /// Extract first file part bytes from multipart/form-data body.
    static func extractFile(body: Data, contentType: String?) -> Data? {
        guard let contentType,
              let range = contentType.range(of: "boundary=")
        else { return nil }
        var boundary = String(contentType[range.upperBound...])
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if boundary.hasPrefix("\"") && boundary.hasSuffix("\"") && boundary.count >= 2 {
            boundary = String(boundary.dropFirst().dropLast())
        }
        let sep = Data("--\(boundary)".utf8)
        guard let first = body.range(of: sep) else { return nil }

        var searchStart = first.upperBound
        while searchStart < body.count {
            // skip CRLF after boundary
            if searchStart + 1 < body.count, body[searchStart] == 0x0d, body[searchStart + 1] == 0x0a {
                searchStart += 2
            }
            guard let headerEnd = body.range(of: Data([0x0d, 0x0a, 0x0d, 0x0a]), in: searchStart..<body.count) else {
                return nil
            }
            let headers = String(data: body.subdata(in: searchStart..<headerEnd.lowerBound), encoding: .utf8) ?? ""
            let contentStart = headerEnd.upperBound
            let nextBoundary: Range<Data.Index>?
            if let nb = body.range(of: Data("\r\n--\(boundary)".utf8), in: contentStart..<body.count) {
                nextBoundary = nb
            } else {
                nextBoundary = body.range(of: sep, in: contentStart..<body.count)
            }
            let contentEnd = nextBoundary?.lowerBound ?? body.count
            let part = body.subdata(in: contentStart..<contentEnd)
            let isFile = headers.lowercased().contains("filename=")
                || headers.lowercased().contains("name=\"file\"")
                || headers.lowercased().contains("application/octet-stream")
                || headers.lowercased().contains("audio/")
            if isFile, part.count > 44 {
                return part
            }
            if let nb = nextBoundary {
                searchStart = nb.upperBound
                // skip trailing --
                continue
            }
            break
        }
        return nil
    }
}
