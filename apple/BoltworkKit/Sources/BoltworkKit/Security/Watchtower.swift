import CryptoKit
import Foundation

public enum WatchtowerCheck: String, CaseIterable, Codable, Sendable {
    case compromisedWebsite, vulnerable, weak, reused, unsecured, inactive2fa, expiring, duplicate

    var weight: Double {
        switch self {
        case .compromisedWebsite, .vulnerable: 5
        case .reused, .weak: 3
        case .unsecured, .inactive2fa, .expiring: 1
        case .duplicate: 0.5
        }
    }

    public var title: String {
        switch self {
        case .compromisedWebsite: "Compromised websites"
        case .vulnerable: "Vulnerable passwords"
        case .weak: "Weak passwords"
        case .reused: "Reused passwords"
        case .unsecured: "Unsecured websites"
        case .inactive2fa: "Two-factor authentication"
        case .expiring: "Expiring"
        case .duplicate: "Duplicates"
        }
    }

    public var symbol: String {
        switch self {
        case .compromisedWebsite: "exclamationmark.shield.fill"
        case .vulnerable: "drop.triangle.fill"
        case .weak: "lock.open.fill"
        case .reused: "arrow.triangle.2.circlepath"
        case .unsecured: "network.slash"
        case .inactive2fa: "key.radiowaves.forward.fill"
        case .expiring: "calendar.badge.exclamationmark"
        case .duplicate: "square.on.square"
        }
    }
}

public struct WatchtowerIssue: Hashable, Identifiable, Sendable {
    public let check: WatchtowerCheck
    public let itemId: String
    public let detail: String
    public var id: String { "\(check.rawValue):\(itemId)" }
}

public struct WatchtowerReport: Sendable {
    public let score: Int
    public let issues: [WatchtowerIssue]
    public var scoreLabel: String {
        score > 900 ? "Excellent" : score > 800 ? "Very Good" : score > 600 ? "Good" : score > 400 ? "Fair" : "Poor"
    }
    public func count(_ check: WatchtowerCheck) -> Int { issues.count { $0.check == check } }
}

/// The security report, computed on this device (see `src/core/watchtower.ts`).
/// Breach checks for passwords are optional and use Have I Been Pwned's k-anonymity API.
public enum Watchtower {
    public static func run(items allItems: [Item], pwnedCounts: [String: Int] = [:], now: Date = .now) -> WatchtowerReport {
        let active = allItems.filter { $0.state == .active }
        var issues = [WatchtowerIssue]()
        func add(_ item: Item, _ check: WatchtowerCheck, _ detail: String) {
            if !item.watchtowerIgnore.contains(check.rawValue) { issues.append(WatchtowerIssue(check: check, itemId: item.id, detail: detail)) }
        }

        var byPassword = [String: [Item]]()
        for item in active {
            guard let pw = item.content.field(for: .password)?.value else { continue }
            byPassword[pw, default: []].append(item)
            if PasswordStrength(pw).isWeak { add(item, .weak, "This password is easy to guess.") }
        }
        for (pw, items) in byPassword {
            if items.count > 1 {
                let others = items.count - 1
                items.forEach { add($0, .reused, "This password is also used by \(others) other item\(others > 1 ? "s" : "").") }
            }
            if let n = pwnedCounts[sha1Hex(pw)], n > 0 {
                items.forEach { add($0, .vulnerable, "This password has appeared in \(n.formatted()) data breaches.") }
            }
        }

        for item in active {
            if item.content.urls.contains(where: { u in u.url.lowercased().hasPrefix("http://") && !isPrivateHost(Domain.host(of: u.url)) }) {
                add(item, .unsecured, "This website address uses HTTP, which is not encrypted.")
            }
        }

        let nowMs = now.timeIntervalSince1970 * 1000
        for item in active {
            guard let exp = item.content.allFields.first(where: { $0.purpose == .expiry && !$0.value.isEmpty }),
                  let t = parseExpiry(exp.value), t < nowMs + 30 * 86_400_000 else { continue }
            add(item, .expiring, t < nowMs ? "This item has expired." : "This item expires in \(Int(ceil((t - nowMs) / 86_400_000))) days.")
        }

        var seen = [String: Item]()
        for item in active {
            guard let user = item.content.field(for: .username)?.value.lowercased(), let first = item.content.urls.first else { continue }
            let host = Domain.base(Domain.host(of: first.url))
            guard !host.isEmpty else { continue }
            let k = "\(item.category.rawValue)|\(host)|\(user)"
            if let original = seen[k] { add(item, .duplicate, "This looks like a duplicate of “\(original.title)”.") } else { seen[k] = item }
        }

        let scorable = Double(max(1, active.count { $0.content.field(for: .password) != nil }))
        let penalty = issues.reduce(0) { $0 + $1.check.weight }
        let score = max(0, Int((1000 * (1 - penalty / (scorable * 8))).rounded()))
        return WatchtowerReport(score: score, issues: issues)
    }

    public static func sha1Hex(_ s: String) -> String {
        Array(Insecure.SHA1.hash(data: Data(s.utf8))).hexString.uppercased()
    }

    /// How many breaches a password appeared in, from the first 5 characters of its SHA-1 only.
    @concurrent
    public static func pwnedCount(sha1: String) async throws -> Int {
        let prefix = String(sha1.prefix(5)), suffix = sha1.dropFirst(5)
        var request = URLRequest(url: URL(string: "https://api.pwnedpasswords.com/range/\(prefix)")!)
        request.setValue("true", forHTTPHeaderField: "Add-Padding")
        let (data, _) = try await URLSession.shared.data(for: request)
        for line in String(decoding: data, as: UTF8.self).split(whereSeparator: \.isNewline) {
            let parts = line.split(separator: ":")
            if parts.count == 2, parts[0] == suffix { return Int(parts[1].trimmingCharacters(in: .whitespaces)) ?? 0 }
        }
        return 0
    }

    static func isPrivateHost(_ host: String) -> Bool {
        host == "localhost" || host.hasSuffix(".local") || host.hasSuffix(".lan") || host.hasPrefix("10.") || host.hasPrefix("127.")
            || host.hasPrefix("192.168.") || host.wholeMatch(of: /172\.(1[6-9]|2\d|3[01])\..*/) != nil
    }

    /// Expiry formats: YYYY-MM-DD, YYYY-MM, MM/YY, MM/YYYY. Returns the last millisecond (UTC) of that day or month.
    public static func parseExpiry(_ value: String) -> Double? {
        let s = value.trimmingCharacters(in: .whitespaces)
        var utc = Calendar(identifier: .gregorian)
        utc.timeZone = TimeZone(identifier: "UTC")!
        func ms(_ y: Int, _ m: Int, _ d: Int) -> Double? {
            utc.date(from: DateComponents(year: y, month: m, day: d)).map { $0.timeIntervalSince1970 * 1000 - 1 }
        }
        if let m = s.wholeMatch(of: /(\d{4})-(\d{1,2})-(\d{1,2})/) { return ms(Int(m.1)!, Int(m.2)!, Int(m.3)! + 1) }
        if let m = s.wholeMatch(of: /(\d{4})-(\d{1,2})/) { return ms(Int(m.1)!, Int(m.2)! + 1, 1) }
        if let m = s.wholeMatch(of: /(\d{1,2})\s*\/\s*(\d{2}|\d{4})/) {
            let y = m.2.count == 2 ? 2000 + Int(m.2)! : Int(m.2)!
            return ms(y, Int(m.1)! + 1, 1)
        }
        return nil
    }
}
