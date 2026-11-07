import Foundation

/// Secrets this device keeps for an account, in the Keychain: the Secret Key (so unlocking only needs the
/// account password, as on the desktop app) and the sync session token.
enum DeviceSecrets {
    private static let secretKeyService = "app.boltwork.secret-key"
    private static let syncTokenService = "app.boltwork.sync-token"

    static func secretKey(account: String) -> String? {
        (try? Keychain.get(service: secretKeyService, account: account)).flatMap { String(data: $0, encoding: .utf8) }
    }

    static func setSecretKey(_ key: String, account: String) throws {
        try Keychain.set(Data(key.utf8), service: secretKeyService, account: account)
    }

    static func syncToken(account: String) -> String? {
        (try? Keychain.get(service: syncTokenService, account: account)).flatMap { String(data: $0, encoding: .utf8) }
    }

    static func setSyncToken(_ token: String?, account: String) throws {
        if let token {
            try Keychain.set(Data(token.utf8), service: syncTokenService, account: account)
        } else {
            Keychain.delete(service: syncTokenService, account: account)
        }
    }

    /// Saves this device's secrets again, which moves ones saved before the app group existed into it.
    static func share(account: String) {
        guard SharedContainer.isAvailable, !SharedContainer.defaults.bool(forKey: "secretsShared.\(account)") else { return }
        if let key = secretKey(account: account) { try? setSecretKey(key, account: account) }
        if let token = syncToken(account: account) { try? setSyncToken(token, account: account) }
        SharedContainer.defaults.set(true, forKey: "secretsShared.\(account)")
    }

    static func forget(account: String) {
        Keychain.delete(service: secretKeyService, account: account)
        Keychain.delete(service: syncTokenService, account: account)
    }
}
