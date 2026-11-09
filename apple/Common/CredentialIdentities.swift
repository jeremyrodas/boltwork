import AuthenticationServices
import BoltworkKit

/// What the system shows in AutoFill suggestions before Boltwork is opened: each login's site and
/// username, and each passkey's site and account. Never a password or key.
enum CredentialIdentities {
    static func identities(for items: [Item]) -> [any ASCredentialIdentity] {
        items.filter { $0.state == .active && $0.category == .login }.flatMap { item -> [any ASCredentialIdentity] in
            let user = item.content.field(for: .username)?.value ?? ""
            let hasPassword = !(item.content.field(for: .password)?.value ?? "").isEmpty
            let hosts = hasPassword ? Set(item.content.urls.map { Domain.host(of: $0.url) }.filter { !$0.isEmpty }) : []
            let passwords: [any ASCredentialIdentity] = hosts.sorted().map {
                ASPasswordCredentialIdentity(serviceIdentifier: ASCredentialServiceIdentifier(identifier: $0, type: .domain), user: user, recordIdentifier: item.id)
            }
            let passkeys: [any ASCredentialIdentity] = item.passkeys.compactMap { p in
                guard let id = WebAuthn.fromBase64URL(p.credentialId), let handle = WebAuthn.fromBase64URL(p.userHandle) else { return nil }
                return ASPasskeyCredentialIdentity(relyingPartyIdentifier: p.rpId, userName: p.userName, credentialID: Data(id), userHandle: Data(handle), recordIdentifier: item.id)
            }
            return passwords + passkeys
        }
    }

    static func replace(with items: [Item]) async {
        let store = ASCredentialIdentityStore.shared
        guard await store.state().isEnabled else { return }
        try? await store.replaceCredentialIdentities(identities(for: items))
    }

    static var isEnabled: Bool {
        get async { await ASCredentialIdentityStore.shared.state().isEnabled }
    }
}
