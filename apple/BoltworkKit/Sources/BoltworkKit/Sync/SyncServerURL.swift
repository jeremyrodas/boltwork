import Foundation

/// Plain http is allowed only for this device and home-network addresses (see `src/core/sync.ts`).
public enum SyncServerURL {
    public enum ValidationError: LocalizedError {
        case empty, needsHTTPS, invalid
        public var errorDescription: String? {
            switch self {
            case .empty: "Enter the server address."
            case .needsHTTPS: "Use an https:// address. Plain http is only allowed for this device or a home-network address (like 192.168.1.20)."
            case .invalid: "That server address isn’t valid."
            }
        }
    }

    public static func isLocalNetworkHost(_ hostname: String) -> Bool {
        let h = hostname.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: "[]"))
        if h == "localhost" || h.hasSuffix(".localhost") || h.hasSuffix(".local") || h.hasSuffix(".home.arpa") { return true }
        if let m = h.wholeMatch(of: /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})/) {
            let a = Int(m.1)!, b = Int(m.2)!
            return a == 127 || a == 10 || (a == 172 && (16...31).contains(b)) || (a == 192 && b == 168) || (a == 169 && b == 254)
        }
        return h == "::1" || h.wholeMatch(of: /f[cd][0-9a-f]{2}:.*/) != nil || h.wholeMatch(of: /fe[89ab][0-9a-f]:.*/) != nil
    }

    public static func normalize(_ input: String) throws -> String {
        var u = input.trimmingCharacters(in: .whitespacesAndNewlines)
        while u.hasSuffix("/") { u.removeLast() }
        guard !u.isEmpty else { throw ValidationError.empty }
        if u.range(of: "^https?://", options: [.regularExpression, .caseInsensitive]) == nil {
            let host = URLComponents(string: "http://\(u)")?.host ?? ""
            u = (isLocalNetworkHost(host) ? "http://" : "https://") + u
        }
        guard let c = URLComponents(string: u), let scheme = c.scheme?.lowercased(), let host = c.host, !host.isEmpty else {
            throw ValidationError.invalid
        }
        if scheme == "http" && !isLocalNetworkHost(host) { throw ValidationError.needsHTTPS }
        var path = c.path
        while path.hasSuffix("/") { path.removeLast() }
        let port = c.port.map { ":\($0)" } ?? ""
        return "\(scheme)://\(host.contains(":") ? "[\(host)]" : host)\(port)\(path)"
    }
}
