import CryptoKit
import Foundation

/// Time-based one-time passwords (RFC 6238) from a base32 secret or an `otpauth://totp/` link.
public struct TOTP: Equatable, Sendable {
    public enum Algorithm: String, Sendable { case sha1 = "SHA1", sha256 = "SHA256", sha512 = "SHA512" }

    public var secret: [UInt8]
    public var algorithm: Algorithm = .sha1
    public var digits = 6
    public var period = 30
    public var issuer: String?
    public var account: String?

    public enum ParseError: LocalizedError {
        case invalidSecret, notTOTP, unsupportedAlgorithm(String)
        public var errorDescription: String? {
            switch self {
            case .invalidSecret: "The one-time password secret is not valid base32."
            case .notTOTP: "Only time-based (TOTP) codes are supported."
            case .unsupportedAlgorithm(let a): "Unsupported algorithm \(a)."
            }
        }
    }

    public init(_ input: String) throws {
        let v = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard v.lowercased().hasPrefix("otpauth://") else {
            secret = try Self.base32Decode(v)
            return
        }
        guard let url = URLComponents(string: v), url.host?.lowercased() == "totp" else { throw ParseError.notTOTP }
        let q = Dictionary((url.queryItems ?? []).map { ($0.name.lowercased(), $0.value ?? "") }, uniquingKeysWith: { a, _ in a })
        let alg = (q["algorithm"] ?? "SHA1").uppercased()
        guard let algorithm = Algorithm(rawValue: alg) else { throw ParseError.unsupportedAlgorithm(alg) }
        self.algorithm = algorithm
        secret = try Self.base32Decode(q["secret"] ?? "")
        digits = Int(q["digits"] ?? "") ?? 6
        period = Int(q["period"] ?? "") ?? 30
        let label = String(url.path.dropFirst())
        let parts = label.split(separator: ":", maxSplits: 1).map(String.init)
        issuer = q["issuer"] ?? (parts.count == 2 ? parts[0] : nil)
        account = (parts.count == 2 ? parts[1] : label).trimmingCharacters(in: .whitespaces)
    }

    public static func base32Decode(_ input: String) throws -> [UInt8] {
        let alphabet = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZ234567")
        let s = input.uppercased().filter { !" \t\n=-".contains($0) }
        guard !s.isEmpty else { throw ParseError.invalidSecret }
        var bits = 0, value = 0
        var out = [UInt8]()
        for c in s {
            guard let i = alphabet.firstIndex(of: c) else { throw ParseError.invalidSecret }
            value = (value << 5) | i
            bits += 5
            if bits >= 8 {
                out.append(UInt8((value >> (bits - 8)) & 255))
                bits -= 8
            }
            value &= (1 << bits) - 1
        }
        return out
    }

    public func code(at date: Date) -> String {
        let counter = UInt64(floor(date.timeIntervalSince1970 / Double(period)))
        let message = withUnsafeBytes(of: counter.bigEndian) { Data($0) }
        let key = SymmetricKey(data: secret)
        let mac: [UInt8] = switch algorithm {
        case .sha1: Array(HMAC<Insecure.SHA1>.authenticationCode(for: message, using: key))
        case .sha256: Array(HMAC<SHA256>.authenticationCode(for: message, using: key))
        case .sha512: Array(HMAC<SHA512>.authenticationCode(for: message, using: key))
        }
        let offset = Int(mac[mac.count - 1] & 15)
        let bin = (UInt32(mac[offset] & 127) << 24) | (UInt32(mac[offset + 1]) << 16) | (UInt32(mac[offset + 2]) << 8) | UInt32(mac[offset + 3])
        var modulus: UInt32 = 1
        for _ in 0..<min(digits, 9) { modulus *= 10 }
        let code = String(bin % modulus)
        return String(repeating: "0", count: max(0, digits - code.count)) + code
    }

    /// Seconds left before the code changes.
    public func remaining(at date: Date) -> Int {
        period - Int(date.timeIntervalSince1970) % period
    }
}
