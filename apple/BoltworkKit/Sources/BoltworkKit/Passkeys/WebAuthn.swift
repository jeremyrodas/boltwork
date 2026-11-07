import CryptoKit
import Foundation

/// Boltwork as a WebAuthn authenticator, matching the desktop app (`src/core/passkeys.ts`):
/// ES256 keys, "none" attestation, user present and verified, backup eligible and backed up, sign count 0.
public enum WebAuthn {
    public static let aaguid: [UInt8] = hex("5d7a6c1e9b3f4c2aa8e15c0d3b7f9e21")
    private static let up: UInt8 = 0x01, uv: UInt8 = 0x04, be: UInt8 = 0x08, bs: UInt8 = 0x10, at: UInt8 = 0x40

    public struct NewCredential: Sendable {
        public let passkey: Passkey
        public let authenticatorData: [UInt8]
        /// CBOR `{fmt: "none", attStmt: {}, authData}`.
        public let attestationObject: [UInt8]
        public let credentialID: [UInt8]
        public let publicKeySPKI: [UInt8]
    }

    public enum Failure: LocalizedError {
        case badUserID, wrongSite, badKey
        public var errorDescription: String? {
            switch self {
            case .badUserID: "The site sent a bad user ID."
            case .wrongSite: "That passkey is for a different site."
            case .badKey: "This passkey’s key can’t be read."
            }
        }
    }

    /// A new key pair and credential ID for `rpId`, and the authenticator data that registers it.
    public static func newCredential(rpId: String, rpName: String?, userHandle: [UInt8], userName: String, userDisplayName: String?,
                                     now: Int64 = Int64((Date.now.timeIntervalSince1970 * 1000).rounded())) throws -> NewCredential {
        guard (1...64).contains(userHandle.count) else { throw Failure.badUserID }
        let key = P256.Signing.PrivateKey()
        let point = [UInt8](key.publicKey.x963Representation) // 04 ‖ x ‖ y
        let credID = VaultCrypto.randomBytes(16)
        let cose = CBOR.map([(.int(1), .int(2)), (.int(3), .int(-7)), (.int(-1), .int(1)),
                             (.int(-2), .bytes(Array(point[1...32]))), (.int(-3), .bytes(Array(point[33...64])))]).encoded
        let authData = sha256(rpId) + [up | uv | be | bs | at] + [0, 0, 0, 0] + aaguid
            + [UInt8(credID.count >> 8), UInt8(credID.count & 0xFF)] + credID + cose
        let attestation = CBOR.map([(.text("fmt"), .text("none")), (.text("attStmt"), .map([])), (.text("authData"), .bytes(authData))]).encoded
        let passkey = Passkey(
            credentialId: base64URL(credID), rpId: rpId, rpName: rpName.map { String($0.prefix(200)) },
            userHandle: base64URL(userHandle), userName: String(userName.prefix(200)),
            userDisplayName: userDisplayName.flatMap { $0.isEmpty ? nil : String($0.prefix(200)) },
            privateKey: base64URL([UInt8](key.derRepresentation)), algorithm: -7, createdAt: now, lastUsedAt: nil)
        return NewCredential(passkey: passkey, authenticatorData: authData, attestationObject: attestation,
                             credentialID: credID, publicKeySPKI: [UInt8](key.publicKey.derRepresentation))
    }

    /// Signs in: authenticator data, and its DER signature over it plus the client data hash.
    public static func assert(_ passkey: Passkey, rpId: String, clientDataHash: [UInt8]) throws -> (authenticatorData: [UInt8], signature: [UInt8]) {
        guard passkey.rpId == rpId else { throw Failure.wrongSite }
        guard let der = fromBase64URL(passkey.privateKey), let key = try? P256.Signing.PrivateKey(derRepresentation: der) else { throw Failure.badKey }
        let authData = sha256(rpId) + [up | uv | be | bs] + [0, 0, 0, 0]
        let signature = try key.signature(for: Data(authData + clientDataHash))
        return (authData, [UInt8](signature.derRepresentation))
    }

    public static func sha256(_ s: String) -> [UInt8] { sha256(Array(s.utf8)) }
    public static func sha256(_ b: [UInt8]) -> [UInt8] { Array(SHA256.hash(data: b)) }

    public static func base64URL(_ b: [UInt8]) -> String {
        Data(b).base64EncodedString().replacing("+", with: "-").replacing("/", with: "_").replacing("=", with: "")
    }

    public static func fromBase64URL(_ s: String) -> [UInt8]? {
        var t = s.replacing("-", with: "+").replacing("_", with: "/")
        t += String(repeating: "=", count: (4 - t.count % 4) % 4)
        return Data(base64Encoded: t).map { [UInt8]($0) }
    }

    private static func hex(_ s: String) -> [UInt8] {
        stride(from: 0, to: s.count, by: 2).map { UInt8(s.dropFirst($0).prefix(2), radix: 16)! }
    }
}
