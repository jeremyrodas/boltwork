import CryptoKit
import Foundation
import Security

/// An SSH private key as Boltwork keeps it on an SSH Key item: unencrypted OpenSSH format, protected by the
/// vault. Ed25519 and RSA, like the desktop app (`src/core/ssh.ts`).
public struct SSHKey: Sendable {
    enum Parts: Sendable {
        case ed25519(seed: [UInt8], publicKey: [UInt8])
        case rsa(n: [UInt8], e: [UInt8], d: [UInt8], p: [UInt8], q: [UInt8], iqmp: [UInt8])
    }

    public enum Failure: LocalizedError {
        case notOpenSSH, encrypted, unsupported(String), corrupted
        public var errorDescription: String? {
            switch self {
            case .notOpenSSH: "This is not an OpenSSH private key."
            case .encrypted: "This key is protected with a passphrase. Remove it first with ssh-keygen -p, then add it to Boltwork, which keeps it encrypted in your vault."
            case .unsupported(let type): "\(type) keys are not supported. Use Ed25519 or RSA."
            case .corrupted: "This key file is corrupted."
            }
        }
    }

    let parts: Parts
    public let comment: String

    private static let magic = Array("openssh-key-v1\0".utf8)

    public init(openSSH text: String) throws {
        let body = text.replacing(/-----(BEGIN|END) OPENSSH PRIVATE KEY-----/, with: "").filter { !$0.isWhitespace }
        guard let data = Data(base64Encoded: body), data.starts(with: Self.magic) else { throw Failure.notOpenSSH }
        var r = SSHWire.Reader(Array(data.dropFirst(Self.magic.count)))
        do {
            guard try r.text() == "none" else { throw Failure.encrypted }
            _ = try r.string(); _ = try r.string()
            guard try r.u32() == 1 else { throw Failure.unsupported("Multi-key") }
            _ = try r.string()
            var s = SSHWire.Reader(try r.string())
            guard try s.u32() == s.u32() else { throw Failure.corrupted }
            let type = try s.text()
            switch type {
            case "ssh-ed25519":
                let pub = try s.string()
                let priv = try s.string()
                guard priv.count == 64 else { throw Failure.corrupted }
                parts = .ed25519(seed: Array(priv.prefix(32)), publicKey: pub)
            case "ssh-rsa":
                let n = try s.mpint(), e = try s.mpint(), d = try s.mpint(), iqmp = try s.mpint(), p = try s.mpint(), q = try s.mpint()
                parts = .rsa(n: n, e: e, d: d, p: p, q: q, iqmp: iqmp)
            default:
                throw Failure.unsupported(type)
            }
            comment = try s.text()
        } catch is SSHWire.Truncated {
            throw Failure.corrupted
        }
    }

    init(parts: Parts, comment: String) {
        self.parts = parts
        self.comment = comment
    }

    /// A new Ed25519 key, the type OpenSSH recommends.
    public static func generateEd25519(comment: String = "") -> SSHKey {
        let key = Curve25519.Signing.PrivateKey()
        return SSHKey(parts: .ed25519(seed: [UInt8](key.rawRepresentation), publicKey: [UInt8](key.publicKey.rawRepresentation)), comment: comment)
    }

    private var wireType: String {
        if case .ed25519 = parts { "ssh-ed25519" } else { "ssh-rsa" }
    }

    /// What the agent advertises, and what authorized_keys holds (base64).
    public var publicBlob: [UInt8] {
        switch parts {
        case .ed25519(_, let pub): SSHWire.string("ssh-ed25519") + SSHWire.string(pub)
        case .rsa(let n, let e, _, _, _, _): SSHWire.string("ssh-rsa") + SSHWire.mpint(e) + SSHWire.mpint(n)
        }
    }

    /// An authorized_keys line.
    public var publicKeyLine: String {
        "\(wireType) \(Data(publicBlob).base64EncodedString())" + (comment.isEmpty ? "" : " \(comment)")
    }

    /// As `ssh-keygen -l` shows it.
    public var fingerprint: String {
        "SHA256:" + Data(SHA256.hash(data: publicBlob)).base64EncodedString().replacing("=", with: "")
    }

    public var typeName: String {
        switch parts {
        case .ed25519: "Ed25519"
        case .rsa(let n, _, _, _, _, _): "RSA \(n.drop { $0 == 0 }.count * 8)-bit"
        }
    }

    /// The private key in OpenSSH format.
    public var openSSH: String {
        let check = VaultCrypto.randomBytes(4)
        let priv: [UInt8] = switch parts {
        case .ed25519(let seed, let pub): SSHWire.string("ssh-ed25519") + SSHWire.string(pub) + SSHWire.string(seed + pub)
        case .rsa(let n, let e, let d, let p, let q, let iqmp):
            SSHWire.string("ssh-rsa") + [n, e, d, iqmp, p, q].flatMap(SSHWire.mpint)
        }
        var section = check + check + priv + SSHWire.string(comment)
        section += (0..<(8 - section.count % 8) % 8).map { UInt8($0 + 1) }
        let body = Self.magic + SSHWire.string("none") + SSHWire.string("none") + SSHWire.string("") + SSHWire.u32(1)
            + SSHWire.string(publicBlob) + SSHWire.string(section)
        let b64 = Data(body).base64EncodedString(options: .lineLength64Characters).replacing("\r\n", with: "\n")
        return "-----BEGIN OPENSSH PRIVATE KEY-----\n\(b64)\n-----END OPENSSH PRIVATE KEY-----\n"
    }

    public static let rsaSHA256: UInt32 = 2
    public static let rsaSHA512: UInt32 = 4

    /// Signs for the SSH agent protocol, returning the signature blob (algorithm name and signature).
    public func sign(_ data: [UInt8], flags: UInt32 = 0) throws -> [UInt8] {
        switch parts {
        case .ed25519(let seed, _):
            let key = try Curve25519.Signing.PrivateKey(rawRepresentation: seed)
            return SSHWire.string("ssh-ed25519") + SSHWire.string([UInt8](try key.signature(for: Data(data))))
        case .rsa(let n, let e, let d, let p, let q, let iqmp):
            let (name, algorithm): (String, SecKeyAlgorithm) =
                flags & Self.rsaSHA512 != 0 ? ("rsa-sha2-512", .rsaSignatureMessagePKCS1v15SHA512)
                : flags & Self.rsaSHA256 != 0 ? ("rsa-sha2-256", .rsaSignatureMessagePKCS1v15SHA256)
                : ("ssh-rsa", .rsaSignatureMessagePKCS1v15SHA1)
            let der = DER.sequence([[0], n, e, d, p, q, BigBytes.mod(d, BigBytes.minusOne(p)), BigBytes.mod(d, BigBytes.minusOne(q)), iqmp].map(DER.integer))
            var error: Unmanaged<CFError>?
            let attributes = [kSecAttrKeyType: kSecAttrKeyTypeRSA, kSecAttrKeyClass: kSecAttrKeyClassPrivate] as CFDictionary
            guard let key = SecKeyCreateWithData(Data(der) as CFData, attributes, &error),
                  let signature = SecKeyCreateSignature(key, algorithm, Data(data) as CFData, &error) as Data? else {
                throw error?.takeRetainedValue() ?? Failure.corrupted
            }
            return SSHWire.string(name) + SSHWire.string([UInt8](signature))
        }
    }
}

/// Just enough DER for an RSA private key (PKCS #1).
enum DER {
    static func integer(_ b: [UInt8]) -> [UInt8] {
        var v = Array(b.drop { $0 == 0 })
        if v.isEmpty || v[0] & 0x80 != 0 { v.insert(0, at: 0) }
        return [0x02] + length(v.count) + v
    }

    static func sequence(_ items: [[UInt8]]) -> [UInt8] {
        let body = items.flatMap { $0 }
        return [0x30] + length(body.count) + body
    }

    private static func length(_ n: Int) -> [UInt8] {
        if n < 0x80 { return [UInt8(n)] }
        let bytes = withUnsafeBytes(of: UInt32(n).bigEndian, Array.init).drop { $0 == 0 }
        return [0x80 | UInt8(bytes.count)] + bytes
    }
}

/// Unsigned big-endian integer arithmetic for the RSA CRT exponents, which OpenSSH keys leave out.
enum BigBytes {
    static func minusOne(_ a: [UInt8]) -> [UInt8] {
        var r = a
        for i in r.indices.reversed() {
            if r[i] > 0 { r[i] -= 1; break }
            r[i] = 0xFF
        }
        return r
    }

    /// `a mod m` by shift-and-subtract, one bit of `a` at a time.
    static func mod(_ a: [UInt8], _ m: [UInt8]) -> [UInt8] {
        let m = Array(m.drop { $0 == 0 })
        var r = [UInt8](repeating: 0, count: m.count + 1)
        let mm = [0] + m
        for byte in a {
            for bit in (0..<8).reversed() {
                var carry = (byte >> UInt8(bit)) & 1
                for i in r.indices.reversed() {
                    let next = r[i] >> 7
                    r[i] = r[i] << 1 | carry
                    carry = next
                }
                if !r.lexicographicallyPrecedes(mm) {
                    var borrow = 0
                    for i in r.indices.reversed() {
                        let v = Int(r[i]) - Int(mm[i]) - borrow
                        r[i] = UInt8((v + 256) & 0xFF)
                        borrow = v < 0 ? 1 : 0
                    }
                }
            }
        }
        return r
    }
}
