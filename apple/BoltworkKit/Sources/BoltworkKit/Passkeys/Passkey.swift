import Foundation

/// A passkey kept on a login item, in the desktop app's format (`src/core/passkeys.ts`), so passkeys made on
/// any Boltwork device sign in everywhere. Binary values are base64url.
public struct Passkey: Codable, Equatable, Hashable, Sendable {
    public var credentialId: String
    public var rpId: String
    public var rpName: String?
    /// The site's user.id.
    public var userHandle: String
    public var userName: String
    public var userDisplayName: String?
    /// PKCS#8 DER of the P-256 private key.
    public var privateKey: String
    /// -7: ES256, the only algorithm Boltwork makes.
    public var algorithm: Int
    public var createdAt: Int64
    public var lastUsedAt: Int64?
}

extension Item {
    /// The item's passkeys, stored under `passkeys` with the rest of the record.
    public var passkeys: [Passkey] {
        get {
            guard let value = extras["passkeys"], let data = try? JSONEncoder().encode(value) else { return [] }
            return (try? JSONDecoder().decode([Passkey].self, from: data)) ?? []
        }
        set {
            if newValue.isEmpty {
                extras["passkeys"] = nil
            } else if let data = try? JSONEncoder().encode(newValue), let value = try? JSONDecoder().decode(JSONValue.self, from: data) {
                extras["passkeys"] = value
            }
        }
    }
}
