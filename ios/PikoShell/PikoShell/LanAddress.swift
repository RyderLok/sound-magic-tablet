import Foundation
import Darwin

enum LanAddress {
    /// Best-effort non-loopback IPv4 for hotspot / LAN (e.g. 172.20.10.x).
    static func primaryIPv4() -> String? {
        var addresses: [String] = []
        var ifaddr: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&ifaddr) == 0, let first = ifaddr else { return nil }
        defer { freeifaddrs(first) }

        var ptr: UnsafeMutablePointer<ifaddrs>? = first
        while let p = ptr {
            defer { ptr = p.pointee.ifa_next }
            let iface = p.pointee
            guard let addr = iface.ifa_addr else { continue }
            guard addr.pointee.sa_family == UInt8(AF_INET) else { continue }
            let name = String(cString: iface.ifa_name)
            if name.hasPrefix("lo") { continue }

            var hostname = [CChar](repeating: 0, count: Int(NI_MAXHOST))
            let result = getnameinfo(
                addr,
                socklen_t(addr.pointee.sa_len),
                &hostname,
                socklen_t(hostname.count),
                nil,
                0,
                NI_NUMERICHOST
            )
            guard result == 0 else { continue }
            let ip = String(cString: hostname)
            if ip.hasPrefix("127.") { continue }
            addresses.append(ip)
        }

        // Prefer common phone-hotspot / link-local private ranges used in this project.
        let preferred = addresses.first { $0.hasPrefix("172.") }
            ?? addresses.first { $0.hasPrefix("192.168.") }
            ?? addresses.first { $0.hasPrefix("10.") }
        return preferred ?? addresses.first
    }

    static func uploadHint(port: UInt16 = 8001) -> String {
        if let ip = primaryIPv4() {
            return "http://\(ip):\(port)"
        }
        return "(no LAN IP yet — join hotspot)"
    }
}
