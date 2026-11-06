import Testing
@testable import BoltworkKit

struct CryptoTests {
    let v = Vectors.load

    @Test func blake2bMatchesLibsodium() {
        for b in v.blake {
            #expect(hex(Blake2b.hash(hex(b.msg), outputLength: 32, key: hex(b.key))) == b.out32)
            #expect(hex(Blake2b.hash(hex(b.msg), outputLength: 64)) == b.out64Unkeyed)
        }
    }

    @Test func argon2idMatchesHashWasm() {
        for a in v.argon {
            let out = Argon2id.hash(password: Array(a.password.utf8), salt: hex(a.salt), iterations: a.ops, memoryKiB: a.memKiB)
            #expect(hex(out) == a.out, "argon2id \(a.password)")
        }
    }

    /// RFC 9106 section 5.3, which exercises several lanes, a secret and associated data.
    @Test func argon2idRFCVector() {
        let out = Argon2id.hash(password: [UInt8](repeating: 1, count: 32), salt: [UInt8](repeating: 2, count: 16), iterations: 3,
                                memoryKiB: 32, parallelism: 4, outputLength: 32,
                                secret: [UInt8](repeating: 3, count: 8), associatedData: [UInt8](repeating: 4, count: 12))
        #expect(hex(out) == "0d640df58d78766c08c037a34a8b53c9d01ef0452d75b65eb52520e96b01e659")
    }

    @Test func xchachaMatchesLibsodium() throws {
        for x in v.xchacha {
            let c = try XChaCha20Poly1305.seal(hex(x.msg), key: hex(x.key), nonce: hex(x.nonce), aad: Array(x.aad.utf8))
            #expect(hex(c) == x.c)
            #expect(try XChaCha20Poly1305.open(c, key: hex(x.key), nonce: hex(x.nonce), aad: Array(x.aad.utf8)) == hex(x.msg))
        }
    }

    @Test func xchachaRejectsTampering() throws {
        let x = v.xchacha[2]
        var c = hex(x.c)
        c[3] ^= 1
        #expect(throws: VaultError.decryptionFailed) {
            try XChaCha20Poly1305.open(c, key: hex(x.key), nonce: hex(x.nonce), aad: Array(x.aad.utf8))
        }
        #expect(throws: VaultError.decryptionFailed) {
            try XChaCha20Poly1305.open(hex(x.c), key: hex(x.key), nonce: hex(x.nonce), aad: Array("other".utf8))
        }
    }

    @Test func keyDerivationMatchesDesktop() throws {
        let k = v.keyDerivation
        #expect(try SecretKey.normalize(k.secretKey) == k.normalized)
        let kdf = KdfParams(alg: k.kdf.alg, salt: k.kdf.salt, ops: k.kdf.ops, mem: k.kdf.mem)
        let kek = try VaultCrypto.deriveKek(password: k.password, secretKey: k.secretKey, kdf: kdf)
        #expect(hex(kek) == k.kek)
        #expect(hex(VaultCrypto.authKey(fromKek: kek)) == k.authKey)
    }

    @Test func generatedSecretKeysNormalize() throws {
        for _ in 0..<50 {
            let key = SecretKey.generate()
            #expect(key.count == 4 + 26 + 4)
            #expect(try SecretKey.normalize(key) == key)
        }
        #expect(throws: VaultError.invalidSecretKey) { try SecretKey.normalize("SR1-short") }
    }
}
