import Foundation

/// Vectors written by `apple/tools/make-fixtures.ts` from the desktop app's TypeScript core.
struct Vectors: Decodable {
    struct Blake: Decodable { let msg, key, out32, out64Unkeyed: String }
    struct Argon: Decodable { let password, salt: String; let ops, memKiB: Int; let out: String }
    struct XChaCha: Decodable { let key, nonce, msg, aad, c: String }
    struct KeyDerivation: Decodable {
        struct Kdf: Decodable { let alg, salt: String; let ops, mem: Int }
        let password, secretKey, normalized: String
        let kdf: Kdf
        let kek, authKey: String
    }
    struct Totp: Decodable { let t: Double; let code: String }

    let blake: [Blake]
    let argon: [Argon]
    let xchacha: [XChaCha]
    let keyDerivation: KeyDerivation
    let totp: [Totp]
    let itemId: String

    static let fixtures = Bundle.module.url(forResource: "Fixtures", withExtension: nil)!
    static let load: Vectors = try! JSONDecoder().decode(Vectors.self, from: Data(contentsOf: fixtures.appending(path: "vectors.json")))
}

func hex(_ s: String) -> [UInt8] {
    var out = [UInt8]()
    var i = s.startIndex
    while i < s.endIndex {
        let j = s.index(i, offsetBy: 2)
        out.append(UInt8(s[i..<j], radix: 16)!)
        i = j
    }
    return out
}

func hex(_ b: [UInt8]) -> String { b.map { String(format: "%02x", $0) }.joined() }

/// A fresh copy of the fixture vault in a temporary folder.
func copyOfFixtureVault() throws -> URL {
    let dir = FileManager.default.temporaryDirectory.appending(path: "boltwork-test-\(UUID().uuidString)")
    try FileManager.default.copyItem(at: Vectors.fixtures.appending(path: "vault"), to: dir)
    return dir
}
