import Foundation

/// Host names from item URLs, for matching and Watchtower.
public enum Domain {
    public static func host(of url: String) -> String {
        let trimmed = url.trimmingCharacters(in: .whitespaces)
        let withScheme = trimmed.contains("://") ? trimmed : "https://\(trimmed)"
        return (URLComponents(string: withScheme)?.host ?? "").lowercased().replacing(/^www\./, with: "")
    }

    /// The registrable part of a host, approximately ("mail.google.com" → "google.com", "bbc.co.uk" → "bbc.co.uk").
    public static func base(_ host: String) -> String {
        let parts = host.split(separator: ".")
        guard parts.count > 2 else { return host }
        let twoPartSuffixes: Set<String> = ["co.uk", "org.uk", "ac.uk", "gov.uk", "com.au", "net.au", "co.nz", "co.jp", "com.br", "co.in", "co.za", "com.mx"]
        let lastTwo = parts.suffix(2).joined(separator: ".")
        return (twoPartSuffixes.contains(lastTwo) ? parts.suffix(3) : parts.suffix(2)).joined(separator: ".")
    }

    /// A URL that opens in a browser, adding https:// if the item left it out.
    public static func openableURL(_ url: String) -> URL? {
        let t = url.trimmingCharacters(in: .whitespaces)
        guard !t.isEmpty else { return nil }
        return URL(string: t.contains("://") ? t : "https://\(t)")
    }
}
