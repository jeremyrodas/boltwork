import AuthenticationServices
import BoltworkKit
import LocalAuthentication
import Observation

/// One AutoFill request: unlock the vault with biometrics, then fill a password, sign in with a passkey,
/// or save a new passkey. The extension is too small for the account password's key derivation, so it
/// relies on quick unlock, which the app sets up.
@MainActor
@Observable
final class AutoFillSession {
    enum Request {
        /// The user opened Boltwork from AutoFill to pick a login, or a passkey when `passkey` is set.
        case list([ASCredentialServiceIdentifier], passkey: ASPasskeyCredentialRequestParameters?)
        /// The user opened Boltwork from AutoFill to pick a verification code.
        case codes([ASCredentialServiceIdentifier])
        /// The user picked one of Boltwork's suggestions.
        case provide(any ASCredentialRequest)
        case register(ASPasskeyCredentialRequest)
        /// AutoFill was just turned on for Boltwork.
        case configure
    }

    enum Outcome {
        case password(ASPasswordCredential)
        case assertion(ASPasskeyAssertionCredential)
        case registration(ASPasskeyRegistrationCredential)
        case code(ASOneTimeCodeCredential)
        case configured
        case cancelled(ASExtensionError.Code)
    }

    var request: Request = .configure
    private(set) var store: VaultStore?
    private(set) var problem: String?
    private(set) var unlocking = false
    @ObservationIgnored var finish: (Outcome) -> Void = { _ in }

    // MARK: - Unlocking

    func unlock() async {
        problem = nil
        let directory = SharedContainer.vaultDirectory
        guard let account = VaultStore.peekAccountId(at: directory) else {
            problem = "Open Boltwork and set up your vault first."
            return
        }
        guard let name = QuickUnlock.biometryName else {
            problem = "AutoFill unlocks Boltwork with Face ID or Touch ID, and this device doesn’t have it set up."
            return
        }
        guard QuickUnlock.isEnabled(account: account), QuickUnlock.isShared(account: account) else {
            problem = "Open Boltwork, turn on \(name) unlock in Settings, and unlock Boltwork once with \(name). Then try AutoFill again."
            return
        }
        unlocking = true
        defer { unlocking = false }
        do {
            let key = try await masterKey(account: account)
            let store = try VaultStore.open(at: directory, key: key)
            self.store = store
            didUnlock(store)
        } catch QuickUnlock.Failure.cancelled {
            cancel()
        } catch {
            problem = error.localizedDescription
        }
    }

    /// Face ID refuses to start until the extension's sheet is on screen, which can lag its first appearance.
    private func masterKey(account: String) async throws -> [UInt8] {
        for attempt in 1...5 {
            do {
                return try await QuickUnlock.masterKey(account: account, reason: "Fill from your Boltwork vault")
            } catch let e as LAError where e.code == .notInteractive && attempt < 5 {
                try await Task.sleep(for: .milliseconds(400))
            }
        }
        throw LAError(.notInteractive)
    }

    private func didUnlock(_ store: VaultStore) {
        switch request {
        case .provide(let credentialRequest):
            provide(credentialRequest, from: store)
        case .configure:
            Task { await CredentialIdentities.replace(with: store.items) }
        case .list, .codes, .register:
            break
        }
    }

    func cancel(_ code: ASExtensionError.Code = .userCanceled) {
        store?.lock()
        finish(.cancelled(code))
    }

    func done(_ outcome: Outcome) {
        store?.lock()
        finish(outcome)
    }

    // MARK: - Passwords

    func logins(matching services: [ASCredentialServiceIdentifier]) -> [Item] {
        let bases = Set(services.map { Domain.base($0.type == .URL ? Domain.host(of: $0.identifier) : $0.identifier.lowercased()) })
        return allLogins.filter { item in item.content.urls.contains { bases.contains(Domain.base(Domain.host(of: $0.url))) } }
    }

    var allLogins: [Item] {
        (store?.items ?? []).filter { $0.state == .active && $0.category == .login && !password(of: $0).isEmpty }
            .sorted { $0.title.localizedStandardCompare($1.title) == .orderedAscending }
    }

    func fill(_ item: Item) {
        try? store?.markUsed(item.id)
        done(.password(ASPasswordCredential(user: item.content.field(for: .username)?.value ?? "", password: password(of: item))))
    }

    private func password(of item: Item) -> String { item.content.field(for: .password)?.value ?? "" }

    // MARK: - Verification codes

    var allCodeLogins: [Item] {
        (store?.items ?? []).filter { $0.state == .active && $0.category == .login && Self.totp(of: $0) != nil }
            .sorted { $0.title.localizedStandardCompare($1.title) == .orderedAscending }
    }

    func codeLogins(matching services: [ASCredentialServiceIdentifier]) -> [Item] {
        let bases = Set(services.map { Domain.base($0.type == .URL ? Domain.host(of: $0.identifier) : $0.identifier.lowercased()) })
        return allCodeLogins.filter { item in item.content.urls.contains { bases.contains(Domain.base(Domain.host(of: $0.url))) } }
    }

    func fillCode(_ item: Item) {
        guard let totp = Self.totp(of: item) else { return cancel(.credentialIdentityNotFound) }
        try? store?.markUsed(item.id)
        done(.code(ASOneTimeCodeCredential(code: totp.code(at: .now))))
    }

    static func totp(of item: Item) -> TOTP? {
        item.content.field(for: .totp).flatMap { try? TOTP($0.value) }
    }

    // MARK: - Passkeys

    func passkeys(for parameters: ASPasskeyCredentialRequestParameters) -> [(item: Item, passkey: Passkey)] {
        let allowed = Set(parameters.allowedCredentials.map { WebAuthn.base64URL([UInt8]($0)) })
        return (store?.passkeys(for: parameters.relyingPartyIdentifier) ?? []).filter { allowed.isEmpty || allowed.contains($0.passkey.credentialId) }
    }

    func signIn(with passkey: Passkey, itemId: String, clientDataHash: Data) {
        do {
            let signed = try WebAuthn.assert(passkey, rpId: passkey.rpId, clientDataHash: [UInt8](clientDataHash))
            try? store?.markPasskeyUsed(itemId: itemId, credentialId: passkey.credentialId)
            guard let handle = WebAuthn.fromBase64URL(passkey.userHandle), let id = WebAuthn.fromBase64URL(passkey.credentialId) else { throw WebAuthn.Failure.badKey }
            done(.assertion(ASPasskeyAssertionCredential(userHandle: Data(handle), relyingParty: passkey.rpId, signature: Data(signed.signature),
                                                         clientDataHash: clientDataHash, authenticatorData: Data(signed.authenticatorData), credentialID: Data(id))))
        } catch {
            problem = error.localizedDescription
        }
    }

    private func provide(_ credentialRequest: any ASCredentialRequest, from store: VaultStore) {
        if let passkeyRequest = credentialRequest as? ASPasskeyCredentialRequest,
           let identity = passkeyRequest.credentialIdentity as? ASPasskeyCredentialIdentity {
            let id = WebAuthn.base64URL([UInt8](identity.credentialID))
            guard let match = store.passkeys(for: identity.relyingPartyIdentifier).first(where: { $0.passkey.credentialId == id }) else {
                return cancel(.credentialIdentityNotFound)
            }
            signIn(with: match.passkey, itemId: match.item.id, clientDataHash: passkeyRequest.clientDataHash)
        } else if credentialRequest.type == .oneTimeCode, let id = credentialRequest.credentialIdentity.recordIdentifier,
                  let item = store.items.first(where: { $0.id == id && $0.state == .active }) {
            fillCode(item)
        } else if let id = credentialRequest.credentialIdentity.recordIdentifier,
                  let item = store.items.first(where: { $0.id == id && $0.state == .active }) {
            fill(item)
        } else {
            cancel(.credentialIdentityNotFound)
        }
    }

    // MARK: - Saving a new passkey

    /// Why this passkey can't be made, if it can't.
    func registrationProblem(_ request: ASPasskeyCredentialRequest) -> String? {
        if !request.supportedAlgorithms.contains(.ES256) { return "This site doesn’t accept the kind of passkey Boltwork makes." }
        let excluded = Set((request.excludedCredentials ?? []).map { WebAuthn.base64URL([UInt8]($0.credentialID)) })
        if !excluded.isDisjoint(with: store?.passkeyIDs ?? []) { return "Boltwork already has a passkey for this account." }
        return nil
    }

    func targets(for identity: ASPasskeyCredentialIdentity) -> (targets: [PasskeyTarget], suggested: String?) {
        store?.passkeyTargets(rpId: identity.relyingPartyIdentifier, userName: identity.userName) ?? ([], nil)
    }

    /// Makes the passkey and saves it on `target`, or on a new login when that's nil.
    func register(_ request: ASPasskeyCredentialRequest, target: String?) {
        guard let store, let identity = request.credentialIdentity as? ASPasskeyCredentialIdentity else { return cancel(.failed) }
        do {
            let made = try WebAuthn.newCredential(rpId: identity.relyingPartyIdentifier, rpName: nil, userHandle: [UInt8](identity.userHandle),
                                                  userName: identity.userName, userDisplayName: nil)
            let item = try store.addPasskey(made.passkey, target: target, newLogin: target == nil)
            let saved = ASPasskeyCredentialIdentity(relyingPartyIdentifier: identity.relyingPartyIdentifier, userName: identity.userName,
                                                    credentialID: Data(made.credentialID), userHandle: identity.userHandle, recordIdentifier: item.id)
            Task {
                try? await ASCredentialIdentityStore.shared.saveCredentialIdentities([saved])
                done(.registration(ASPasskeyRegistrationCredential(relyingParty: identity.relyingPartyIdentifier, clientDataHash: request.clientDataHash,
                                                                   credentialID: Data(made.credentialID), attestationObject: Data(made.attestationObject))))
            }
        } catch {
            problem = error.localizedDescription
        }
    }
}
