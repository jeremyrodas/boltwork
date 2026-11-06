import CryptoKit
import Foundation

/// XChaCha20-Poly1305 (IETF), byte-compatible with libsodium's `crypto_aead_xchacha20poly1305_ietf_*`:
/// HChaCha20 derives a subkey from the first 16 nonce bytes, then ChaCha20-Poly1305 runs with the last 8.
enum XChaCha20Poly1305 {
    static let keyLength = 32
    static let nonceLength = 24

    /// Returns ciphertext followed by the 16-byte tag, as libsodium does.
    static func seal(_ plaintext: [UInt8], key: [UInt8], nonce: [UInt8], aad: [UInt8]) throws -> [UInt8] {
        let (subkey, inner) = try derive(key: key, nonce: nonce)
        let box = try ChaChaPoly.seal(plaintext, using: subkey, nonce: inner, authenticating: aad)
        return [UInt8](box.ciphertext) + [UInt8](box.tag)
    }

    /// Throws `VaultError.decryptionFailed` if the key is wrong or the data was changed.
    static func open(_ sealed: [UInt8], key: [UInt8], nonce: [UInt8], aad: [UInt8]) throws -> [UInt8] {
        guard sealed.count >= 16 else { throw VaultError.decryptionFailed }
        let (subkey, inner) = try derive(key: key, nonce: nonce)
        do {
            let box = try ChaChaPoly.SealedBox(nonce: inner, ciphertext: sealed.dropLast(16), tag: sealed.suffix(16))
            return [UInt8](try ChaChaPoly.open(box, using: subkey, authenticating: aad))
        } catch {
            throw VaultError.decryptionFailed
        }
    }

    private static func derive(key: [UInt8], nonce: [UInt8]) throws -> (SymmetricKey, ChaChaPoly.Nonce) {
        guard key.count == keyLength, nonce.count == nonceLength else { throw VaultError.decryptionFailed }
        let subkey = hChaCha20(key: key, nonce: Array(nonce[0..<16]))
        let inner = try ChaChaPoly.Nonce(data: [0, 0, 0, 0] + nonce[16..<24])
        return (SymmetricKey(data: subkey), inner)
    }

    static func hChaCha20(key: [UInt8], nonce: [UInt8]) -> [UInt8] {
        func word(_ b: [UInt8], _ i: Int) -> UInt32 {
            UInt32(b[i]) | UInt32(b[i + 1]) << 8 | UInt32(b[i + 2]) << 16 | UInt32(b[i + 3]) << 24
        }
        var s: [UInt32] = [0x6170_7865, 0x3320_646e, 0x7962_2d32, 0x6b20_6574]
        for i in 0..<8 { s.append(word(key, i * 4)) }
        for i in 0..<4 { s.append(word(nonce, i * 4)) }

        func qr(_ a: Int, _ b: Int, _ c: Int, _ d: Int) {
            s[a] &+= s[b]; s[d] ^= s[a]; s[d] = s[d] << 16 | s[d] >> 16
            s[c] &+= s[d]; s[b] ^= s[c]; s[b] = s[b] << 12 | s[b] >> 20
            s[a] &+= s[b]; s[d] ^= s[a]; s[d] = s[d] << 8 | s[d] >> 24
            s[c] &+= s[d]; s[b] ^= s[c]; s[b] = s[b] << 7 | s[b] >> 25
        }
        for _ in 0..<10 {
            qr(0, 4, 8, 12); qr(1, 5, 9, 13); qr(2, 6, 10, 14); qr(3, 7, 11, 15)
            qr(0, 5, 10, 15); qr(1, 6, 11, 12); qr(2, 7, 8, 13); qr(3, 4, 9, 14)
        }
        return [0, 1, 2, 3, 12, 13, 14, 15].flatMap { i in (0..<4).map { UInt8(truncatingIfNeeded: s[i] >> UInt32($0 * 8)) } }
    }
}
