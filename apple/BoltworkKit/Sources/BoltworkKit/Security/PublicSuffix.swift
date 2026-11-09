import Foundation

/// The public suffix list, as the desktop app uses it (tldts): which names anyone can register under
/// ("com", "co.uk", "github.io"), so a site can't claim one as its own.
public enum PublicSuffix {
    private struct Rules: Sendable {
        var exact: Set<String> = [], wildcard: Set<String> = [], exceptions: Set<String> = []
    }

    private static let rules: Rules = {
        var r = Rules()
        guard let url = Bundle.module.url(forResource: "public-suffixes", withExtension: "txt"),
              let text = try? String(contentsOf: url, encoding: .utf8) else { return r }
        for line in text.split(separator: "\n") where !line.hasPrefix("//") {
            if line.hasPrefix("!") { r.exceptions.insert(String(line.dropFirst())) }
            else if line.hasPrefix("*.") { r.wildcard.insert(String(line.dropFirst(2))) }
            else { r.exact.insert(String(line)) }
        }
        return r
    }()

    /// The host's public suffix: "co.uk" for "news.bbc.co.uk". A name not on the list is its own last label.
    public static func suffix(of host: String) -> String {
        let labels = host.lowercased().split(separator: ".").map(String.init)
        guard !labels.isEmpty else { return host }
        func join(_ from: Int) -> String { labels[from...].joined(separator: ".") }
        for i in labels.indices where rules.exceptions.contains(join(i)) {
            return join(i + 1)
        }
        for i in labels.indices {
            if rules.exact.contains(join(i)) || (i + 1 < labels.count && rules.wildcard.contains(join(i + 1))) { return join(i) }
        }
        return labels[labels.count - 1]
    }

    /// The registrable domain, one label more than the suffix ("bbc.co.uk"), or nil when the host is a suffix itself.
    public static func registrableDomain(_ host: String) -> String? {
        let suffix = suffix(of: host)
        let labels = host.lowercased().split(separator: ".")
        let suffixCount = suffix.split(separator: ".").count
        return labels.count > suffixCount ? labels.suffix(suffixCount + 1).joined(separator: ".") : nil
    }
}
