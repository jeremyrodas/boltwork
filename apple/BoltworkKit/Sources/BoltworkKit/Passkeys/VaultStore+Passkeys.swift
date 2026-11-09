import Foundation

/// A login a new passkey could go on.
public struct PasskeyTarget: Identifiable, Sendable {
    public let itemId: String
    public let title: String
    public let userName: String
    public let sameAccount: Bool
    public var id: String { itemId }
}

extension VaultStore {
    /// Active items' passkeys for a relying party.
    public func passkeys(for rpId: String) -> [(item: Item, passkey: Passkey)] {
        items.filter { $0.state == .active }.flatMap { item in item.passkeys.filter { $0.rpId == rpId }.map { (item, $0) } }
    }

    /// Every passkey credential ID in the vault, to honor a site's excludeCredentials.
    public var passkeyIDs: Set<String> { Set(items.flatMap { $0.passkeys.map(\.credentialId) }) }

    /// The site's logins a new passkey could join, the same account first, and where it goes by default (nil: a new login).
    public func passkeyTargets(rpId: String, userName: String) -> (targets: [PasskeyTarget], suggested: String?) {
        let candidates = passkeyCandidates(rpId)
        let want = userName.lowercased()
        let targets = candidates.map { item in
            let user = item.content.field(for: .username)?.value ?? ""
            return PasskeyTarget(itemId: item.id, title: item.title, userName: user, sameAccount: !want.isEmpty && user.lowercased() == want)
        }.sorted { $0.sameAccount && !$1.sameAccount }
        return (targets, autoTarget(candidates, userName: userName)?.id)
    }

    /// Saves a new passkey on `target`, or on the site's login for that account, or a new login. Returns that item.
    @discardableResult
    public func addPasskey(_ passkey: Passkey, target: String? = nil, newLogin: Bool = false) throws -> Item {
        let candidates = passkeyCandidates(passkey.rpId)
        let chosen = newLogin ? nil : target.map { t in candidates.first { $0.id == t } } ?? autoTarget(candidates, userName: passkey.userName)
        if !newLogin, target != nil, chosen == nil { throw VaultError.notFound("That login") }
        if let chosen {
            return try patch(chosen.id) { $0.passkeys.append(passkey) }
        }
        var content = ItemTemplate.blankContent(.login)
        content.title = passkey.rpName.flatMap { $0.trimmingCharacters(in: .whitespaces).isEmpty ? nil : $0 } ?? passkey.rpId
        let local = passkey.rpId == "localhost" || passkey.rpId.hasSuffix(".localhost")
        content.urls = [ItemURL(url: "\(local ? "http" : "https")://\(passkey.rpId)", primary: true)]
        if let i = content.fields.firstIndex(where: { $0.purpose == .username }) { content.fields[i].value = passkey.userName }
        let created = try saveItem(id: nil, vaultId: vaults[0].id, content: content)
        return try patch(created.id) { $0.passkeys = [passkey] }
    }

    public func markPasskeyUsed(itemId: String, credentialId: String) throws {
        try patch(itemId, touch: false) { item in
            var keys = item.passkeys
            if let i = keys.firstIndex(where: { $0.credentialId == credentialId }) { keys[i].lastUsedAt = Self.now() }
            item.passkeys = keys
            item.useCount += 1
            item.lastUsedAt = Self.now()
        }
    }

    public func removePasskey(itemId: String, credentialId: String) throws {
        try patch(itemId) { $0.passkeys.removeAll { $0.credentialId == credentialId } }
    }

    private func passkeyCandidates(_ rpId: String) -> [Item] {
        items.filter { item in
            item.state == .active && item.category == .login
                && item.content.urls.contains { let h = Domain.host(of: $0.url); return h == rpId || h.hasSuffix(".\(rpId)") }
        }
    }

    private func autoTarget(_ candidates: [Item], userName: String) -> Item? {
        func user(_ i: Item) -> String { (i.content.field(for: .username)?.value ?? "").lowercased() }
        if !userName.isEmpty, let match = candidates.first(where: { user($0) == userName.lowercased() }) { return match }
        return candidates.count == 1 && user(candidates[0]).isEmpty ? candidates[0] : nil
    }
}
