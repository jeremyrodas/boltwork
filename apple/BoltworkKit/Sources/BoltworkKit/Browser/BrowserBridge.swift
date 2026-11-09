import CryptoKit
import Foundation

/// A browser the user connected to Boltwork. Only the token's hash is kept.
public struct BrowserPairing: Codable, Identifiable, Sendable {
    public let id: String
    public let name: String
    public let origin: String
    public let tokenHash: String
    public let createdAt: Int64
    public var lastUsedAt: Int64
}

/// The connected browsers, in a JSON file shaped like the desktop app's.
public struct BrowserPairings: Sendable {
    public let file: URL
    public init(file: URL) { self.file = file }

    public var all: [BrowserPairing] {
        (try? Data(contentsOf: file)).flatMap { try? JSONDecoder().decode([BrowserPairing].self, from: $0) } ?? []
    }

    private func write(_ pairings: [BrowserPairing]) {
        try? FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? JSONEncoder().encode(pairings).write(to: file, options: [.atomic, .completeFileProtection])
    }

    private static func hash(_ token: String) -> String { SHA256.hash(data: Data(token.utf8)).map { String(format: "%02x", $0) }.joined() }

    /// Connects a browser and returns the token it will send with every request.
    func add(name: String, origin: String) -> String {
        let token = WebAuthn.base64URL(VaultCrypto.randomBytes(32))
        let now = VaultStore.now()
        write(all + [BrowserPairing(id: VaultCrypto.randomBytes(8).map { String(format: "%02x", $0) }.joined(), name: name, origin: origin,
                                    tokenHash: Self.hash(token), createdAt: now, lastUsedAt: now)])
        return token
    }

    func check(_ token: String?) -> BrowserPairing? {
        guard let token, !token.isEmpty else { return nil }
        var pairings = all
        guard let i = pairings.firstIndex(where: { $0.tokenHash == Self.hash(token) }) else { return nil }
        if VaultStore.now() - pairings[i].lastUsedAt > 60_000 {
            pairings[i].lastUsedAt = VaultStore.now()
            write(pairings)
        }
        return pairings[i]
    }

    public func revoke(id: String) { write(all.filter { $0.id != id }) }
}

/// What Boltwork asks before making or using a passkey for a page.
public struct BrowserPasskeyPrompt: Sendable {
    public enum Kind: Sendable { case create, get }
    public let kind: Kind
    public let site: String
    /// create: the account name; get: one entry per passkey to choose from.
    public let accounts: [String]
    /// create: logins the passkey could join, and the one picked to start with (nil: a new login).
    public let targets: [PasskeyTarget]
    public let suggested: String?
}

public enum BrowserPasskeyDecision: Sendable {
    /// `target`: create only; the login to add it to, or nil for a new login.
    case ok(index: Int, target: String?)
    /// Let the browser handle it (another device, or its own passkeys).
    case fallback
    case cancel
}

/// The app side of the bridge: the vault, and the user's answers.
@MainActor
public protocol BrowserBridgeHost: AnyObject {
    var store: VaultStore? { get }
    var version: String { get }
    func approvePairing(code: String, name: String, origin: String) async -> Bool
    func approvePasskey(_ prompt: BrowserPasskeyPrompt) async -> BrowserPasskeyDecision
    /// Brings up the lock screen and waits for an unlock; false if it didn't happen in time.
    func waitForUnlock() async -> Bool
    func showMain(route: String?)
    /// The vault changed (and was saved).
    func changed()
}

/// The browser extension's view of the vault, a port of the desktop app's (`src/core/browserBridge.ts`).
/// Every request except pairing must carry a token the user approved. The extension gets a password only
/// for an item whose website matches the page, or one the user picked by hand.
@MainActor
public final class BrowserBridge {
    public let pairings: BrowserPairings
    private weak var host: (any BrowserBridgeHost)?

    public init(host: any BrowserBridgeHost, pairingsFile: URL) {
        self.host = host
        pairings = BrowserPairings(file: pairingsFile)
    }

    private static let cancelled: JSONValue = ["error": ["name": "NotAllowedError", "message": "The request was cancelled."]]

    /// Handles one request. `origin` is the extension origin the browser reported to the native host.
    public func handle(_ msg: JSONValue, origin: String) async -> JSONValue {
        guard let host else { return ["error": "not-running"] }
        let type = msg["type"]?.stringValue ?? ""
        if type == "pair" {
            let code = String(msg["code"]?.text.prefix(12) ?? "")
            let name = String((msg["name"]?.stringValue ?? "Browser").prefix(60))
            guard await host.approvePairing(code: code, name: name, origin: origin) else { return ["error": "denied"] }
            return ["token": .string(pairings.add(name: name, origin: origin))]
        }
        guard pairings.check(msg["token"]?.stringValue) != nil else { return ["error": "unpaired"] }
        if type.hasPrefix("passkey") {
            do {
                return try await passkey(type, msg, host: host)
            } catch let e as WebAuthn.PageError {
                return ["error": ["name": .string(e.name), "message": .string(e.message)]]
            } catch {
                return ["error": .string(error.localizedDescription)]
            }
        }
        if type == "status" { return ["locked": .bool(host.store == nil), "version": .string(host.version)] }
        if type == "open" {
            host.showMain(route: msg["route"]?.stringValue)
            return ["ok": true]
        }
        guard let store = host.store else { return ["locked": true] }
        let items = store.items

        switch type {
        case "matches":
            return ["items": .array(Self.matchLogins(items, pageURL: msg["url"]?.text ?? "").map(\.json))]
        case "search":
            let q = (msg["query"]?.text ?? "").lowercased().trimmingCharacters(in: .whitespaces)
            let hits = items.filter { i in
                i.category == .login && i.state == .active
                    && (q.isEmpty || i.title.lowercased().contains(q) || Self.username(i).lowercased().contains(q) || i.content.urls.contains { $0.url.lowercased().contains(q) })
            }
            return ["items": .array(hits.prefix(50).map { Match(item: $0, url: $0.content.urls.first?.url ?? "", exactHost: false).json })]
        case "fill":
            guard let item = items.first(where: { $0.id == msg["id"]?.stringValue && $0.state == .active }) else { return ["error": "not-found"] }
            if msg["explicit"]?.boolValue != true, Self.matchLogins([item], pageURL: msg["url"]?.text ?? "").isEmpty { return ["error": "domain-mismatch"] }
            try? store.markUsed(item.id)
            host.changed()
            let code = (item.content.field(for: .totp)?.value).flatMap { try? TOTP($0) }?.code(at: .now) ?? ""
            return ["username": .string(Self.username(item)), "password": .string(Self.password(item)), "totp": .string(code)]
        case "checkSave":
            let pw = msg["password"]?.text ?? "", user = msg["username"]?.text ?? "", url = msg["url"]?.text ?? ""
            if pw.isEmpty { return ["status": "same"] }
            let matches = Self.matchLogins(items, pageURL: url).compactMap { m in items.first { $0.id == m.item.id } }
            let sameUser = matches.filter { Self.username($0).lowercased() == user.lowercased() }
            if sameUser.contains(where: { Self.password($0) == pw }) { return ["status": "same"] }
            if let first = sameUser.first { return ["status": "update", "id": .string(first.id), "title": .string(first.title)] }
            if user.isEmpty, matches.count == 1, Self.password(matches[0]) != pw {
                return ["status": "update", "id": .string(matches[0].id), "title": .string(matches[0].title)]
            }
            if matches.contains(where: { Self.password($0) == pw }) { return ["status": "same"] }
            return ["status": "new", "title": .string(Self.hostOf(url))]
        case "save":
            let url = msg["url"]?.text ?? ""
            let pageHost = Self.hostOf(url)
            guard !pageHost.isEmpty, let o = try? WebAuthn.checkOriginLoosely(url) else { return ["error": "bad-url"] }
            var c = ItemTemplate.blankContent(.login)
            c.title = String((msg["title"]?.stringValue.flatMap { $0.isEmpty ? nil : $0 } ?? pageHost).prefix(200))
            c.urls = [ItemURL(url: o, primary: true)]
            if let i = c.fields.firstIndex(where: { $0.purpose == .username }) { c.fields[i].value = msg["username"]?.text ?? "" }
            if let i = c.fields.firstIndex(where: { $0.purpose == .password }) { c.fields[i].value = msg["password"]?.text ?? "" }
            guard let vault = store.vaults.first, let item = try? store.saveItem(id: nil, vaultId: vault.id, content: c) else { return ["error": "save-failed"] }
            host.changed()
            return ["id": .string(item.id), "title": .string(item.title)]
        case "update":
            guard let item = items.first(where: { $0.id == msg["id"]?.stringValue && $0.state == .active }) else { return ["error": "not-found"] }
            var c = item.content
            if let i = c.fields.firstIndex(where: { $0.purpose == .password }) { c.fields[i].value = msg["password"]?.text ?? "" }
            if let i = c.fields.firstIndex(where: { $0.purpose == .username }), c.fields[i].value.isEmpty, let u = msg["username"]?.text, !u.isEmpty {
                c.fields[i].value = u
            }
            guard (try? store.saveItem(id: item.id, vaultId: item.vaultId, content: c)) != nil else { return ["error": "save-failed"] }
            host.changed()
            return ["id": .string(item.id), "title": .string(item.title)]
        default:
            return ["error": "unknown-request"]
        }
    }

    private func passkey(_ type: String, _ msg: JSONValue, host: any BrowserBridgeHost) async throws -> JSONValue {
        let origin = try WebAuthn.checkOrigin(msg["url"]?.text ?? "")
        if type == "passkeyList" {
            // For the extension's own sign-in menu: which accounts have passkeys here. No keys leave the app.
            guard let store = host.store else { return ["passkeys": []] }
            let rpId = try WebAuthn.checkRpId(origin, requested: msg["rpId"]?.stringValue)
            return ["passkeys": .array(store.passkeys(for: rpId).map {
                ["credentialId": .string($0.passkey.credentialId), "userName": .string($0.passkey.userName), "title": .string($0.item.title)]
            })]
        }
        let request = msg["request"] ?? [:]
        if host.store == nil {
            // Silent autofill requests never pop up the lock screen; the browser's own UI still works.
            if type == "passkeyGet", msg["conditional"]?.boolValue == true, msg["credentialId"] == nil { return ["fallback": true] }
            guard await host.waitForUnlock(), host.store != nil else { return ["fallback": true] }
        }
        guard let store = host.store else { return ["fallback": true] }

        if type == "passkeyCreate" {
            let rpId = try WebAuthn.checkRpId(origin, requested: request["rp"]?["id"]?.stringValue)
            let rpName = request["rp"]?["name"]?.stringValue
            let site = rpName.map { "\($0) (\(rpId))" } ?? rpId
            let excluded = Set((request["excludeCredentials"]?.arrayValue ?? []).compactMap { $0["id"]?.stringValue })
            if !excluded.isDisjoint(with: store.passkeyIDs) {
                throw WebAuthn.PageError("InvalidStateError", "Boltwork already has a passkey for this account.")
            }
            let userName = request["user"]?["name"]?.text ?? ""
            let account = request["user"]?["displayName"]?.stringValue.flatMap { $0.isEmpty ? nil : $0 } ?? (userName.isEmpty ? "this account" : userName)
            let choices = store.passkeyTargets(rpId: rpId, userName: userName)
            let decision = await host.approvePasskey(BrowserPasskeyPrompt(kind: .create, site: site, accounts: [account], targets: choices.targets, suggested: choices.suggested))
            guard case .ok(_, let target) = decision else { return decision.isFallback ? ["fallback": true] : Self.cancelled }
            let made = try WebAuthn.createForPage(request, origin: origin)
            guard let live = host.store else { return Self.cancelled } // locked while the prompt was open
            try live.addPasskey(made.passkey, target: target, newLogin: target == nil)
            host.changed()
            return ["response": made.response]
        }

        let options = try WebAuthn.usable(store.passkeys(for: try WebAuthn.checkRpId(origin, requested: request["rpId"]?.stringValue)),
                                          passkey: \.passkey, request: request, origin: origin)
        if options.isEmpty { return ["fallback": true] }
        let chosen: (item: Item, passkey: Passkey)
        if let picked = msg["credentialId"]?.stringValue {
            // Picked in the extension's in-page menu with a real click.
            guard let match = options.first(where: { $0.passkey.credentialId == picked }) else { return Self.cancelled }
            chosen = match
        } else {
            let accounts = options.map { $0.passkey.userName.isEmpty ? ($0.passkey.userDisplayName ?? $0.item.title) : $0.passkey.userName }
            let decision = await host.approvePasskey(BrowserPasskeyPrompt(kind: .get, site: origin.host, accounts: accounts, targets: [], suggested: nil))
            guard case .ok(let index, _) = decision, options.indices.contains(index) else { return decision.isFallback ? ["fallback": true] : Self.cancelled }
            chosen = options[index]
        }
        guard let live = host.store else { return Self.cancelled }
        let response = try WebAuthn.assertForPage(chosen.passkey, request: request, origin: origin)
        try? live.markPasskeyUsed(itemId: chosen.item.id, credentialId: chosen.passkey.credentialId)
        host.changed()
        return ["response": response]
    }

    // MARK: - Matching

    struct Match {
        let item: Item
        let url: String
        let exactHost: Bool
        var json: JSONValue {
            ["id": .string(item.id), "title": .string(item.title), "username": .string(BrowserBridge.username(item)), "url": .string(url),
             "hasTotp": .bool(!(item.content.field(for: .totp)?.value ?? "").isEmpty), "exactHost": .bool(exactHost)]
        }
    }

    nonisolated static func username(_ i: Item) -> String { i.content.field(for: .username)?.value ?? "" }
    nonisolated static func password(_ i: Item) -> String { i.content.field(for: .password)?.value ?? "" }

    /// An http(s) page's host without "www.".
    nonisolated static func hostOf(_ url: String) -> String {
        guard let c = URLComponents(string: url), ["http", "https"].contains(c.scheme?.lowercased() ?? ""), let h = c.host else { return "" }
        return h.lowercased().replacing(/^www\./, with: "")
    }

    private nonisolated static func baseDomain(_ host: String) -> String { PublicSuffix.registrableDomain(host) ?? host }

    /// Logins whose websites share the page's registrable domain; exact host matches first.
    nonisolated static func matchLogins(_ items: [Item], pageURL: String) -> [Match] {
        let host = hostOf(pageURL)
        guard !host.isEmpty else { return [] }
        let base = baseDomain(host)
        var out: [Match] = []
        for item in items where item.category == .login && item.state == .active {
            var best: (url: String, exact: Bool)?
            for u in item.content.urls {
                let h = Domain.host(of: u.url)
                if h.isEmpty { continue }
                if h == host { best = (u.url, true); break }
                if best == nil, baseDomain(h) == base { best = (u.url, false) }
            }
            if let best { out.append(Match(item: item, url: best.url, exactHost: best.exact)) }
        }
        return out.sorted { a, b in a.exactHost != b.exactHost ? a.exactHost : a.item.title < b.item.title }
    }
}

extension BrowserPasskeyDecision {
    var isFallback: Bool { if case .fallback = self { true } else { false } }
}

extension WebAuthn {
    /// The page's origin (scheme, host and port), for a saved login's website.
    static func checkOriginLoosely(_ url: String) throws -> String {
        guard let c = URLComponents(string: url), let scheme = c.scheme, let host = c.host else { throw PageError("SecurityError", "Bad URL.") }
        return "\(scheme)://\(host)" + (c.port.map { ":\($0)" } ?? "")
    }
}
