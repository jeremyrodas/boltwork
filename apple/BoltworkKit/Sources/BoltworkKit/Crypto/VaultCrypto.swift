import CryptoKit
import Foundation

/// Key derivation and sealing, matching `src/core/crypto.ts`.
///
/// The account password is stretched with Argon2id, then mixed with the 128-bit Secret Key through keyed
/// BLAKE2b. Everything is sealed with XChaCha20-Poly1305 and bound to its purpose with associated data.
public enum VaultCrypto {
    /// Argon2id cost for new vaults: 3 passes over 128 MiB, the desktop app's default.
    public static let strongCost = KdfCost(ops: 3, mem: 128 * 1024 * 1024)
    public static let fastCostForTests = KdfCost(ops: 2, mem: 16 * 1024 * 1024)

    public static func newKdfParams(cost: KdfCost = strongCost) -> KdfParams {
        KdfParams(alg: "argon2id13", salt: Data(randomBytes(16)).base64EncodedString(), ops: cost.ops, mem: cost.mem)
    }

    /// The key-encryption key, from password + Secret Key. Runs Argon2id, so call it off the main actor.
    public static func deriveKek(password: String, secretKey: String, kdf: KdfParams) throws -> [UInt8] {
        let normalized = try SecretKey.normalize(secretKey)
        var stretched = try stretch(password: password, kdf: kdf)
        defer { wipe(&stretched) }
        return Blake2b.hash(stretched, outputLength: 32, key: Array(normalized.utf8))
    }

    /// Password-only key, used by encrypted exports.
    public static func derivePasswordKey(password: String, kdf: KdfParams) throws -> [UInt8] {
        try stretch(password: password, kdf: kdf)
    }

    /// The sync sign-in key: a one-way derivative of the KEK, so the server learns nothing that decrypts the vault.
    public static func authKey(fromKek kek: [UInt8]) -> [UInt8] {
        // Internal format labels keep the app's earlier name (Strongroom).
        Blake2b.hash(Array("strongroom:sync-auth:v1".utf8), outputLength: 32, key: kek)
    }

    private static func stretch(password: String, kdf: KdfParams) throws -> [UInt8] {
        guard kdf.alg == "argon2id13", let salt = Data(base64Encoded: kdf.salt) else { throw VaultError.unsupportedFormat }
        let normalized = password.decomposedStringWithCompatibilityMapping
        return Argon2id.hash(password: Array(normalized.utf8), salt: [UInt8](salt), iterations: kdf.ops, memoryKiB: kdf.mem / 1024)
    }

    public static func randomKey() -> [UInt8] { randomBytes(32) }

    public static func randomBytes(_ count: Int) -> [UInt8] {
        var rng = SystemRandomNumberGenerator()
        return (0..<count).map { _ in UInt8.random(in: .min ... .max, using: &rng) }
    }

    /// A random 24-character hex id, like the desktop app's `randomId()`.
    public static func randomId() -> String {
        randomBytes(12).map { String(format: "%02x", $0) }.joined()
    }

    public static func seal(_ plaintext: [UInt8], key: [UInt8], aad: String) throws -> Sealed {
        let nonce = randomBytes(XChaCha20Poly1305.nonceLength)
        let c = try XChaCha20Poly1305.seal(plaintext, key: key, nonce: nonce, aad: Array(aad.utf8))
        return Sealed(n: Data(nonce).base64EncodedString(), c: Data(c).base64EncodedString())
    }

    public static func open(_ sealed: Sealed, key: [UInt8], aad: String) throws -> [UInt8] {
        guard let nonce = Data(base64Encoded: sealed.n), let c = Data(base64Encoded: sealed.c) else { throw VaultError.decryptionFailed }
        return try XChaCha20Poly1305.open([UInt8](c), key: key, nonce: [UInt8](nonce), aad: Array(aad.utf8))
    }

    public static func sealJSON<T: Encodable>(_ value: T, key: [UInt8], aad: String) throws -> Sealed {
        try seal([UInt8](JSONCoding.encode(value)), key: key, aad: aad)
    }

    public static func openJSON<T: Decodable>(_ type: T.Type, from sealed: Sealed, key: [UInt8], aad: String) throws -> T {
        try JSONCoding.decoder.decode(type, from: Data(open(sealed, key: key, aad: aad)))
    }

    public static func wipe(_ bytes: inout [UInt8]) {
        for i in bytes.indices { bytes[i] = 0 }
    }
}
