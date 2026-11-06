/// The account's Secret Key: "SR1-" and 26 Crockford base32 characters (128 bits).
public enum SecretKey {
    private static let alphabet = Array("0123456789ABCDEFGHJKMNPQRSTVWXYZ")

    public static func generate() -> String {
        let bytes = VaultCrypto.randomBytes(16)
        var bits = 0, value = 0, out = ""
        for byte in bytes {
            value = (value << 8) | Int(byte)
            bits += 8
            while bits >= 5 {
                out.append(alphabet[(value >> (bits - 5)) & 31])
                bits -= 5
            }
            value &= (1 << bits) - 1
        }
        if bits > 0 { out.append(alphabet[(value << (5 - bits)) & 31]) }
        return format(Array(out))
    }

    /// Accepts any case, spacing or dashes, and the look-alikes O, I and L.
    public static func normalize(_ input: String) throws -> String {
        var raw = input.uppercased().filter { $0.isASCII && ($0.isLetter || $0.isNumber) }
        if raw.hasPrefix("SR1") { raw.removeFirst(3) }
        raw = String(raw.map { c -> Character in
            switch c {
            case "O": "0"
            case "I", "L": "1"
            default: c
            }
        })
        guard raw.count == 26, raw.allSatisfy(alphabet.contains) else { throw VaultError.invalidSecretKey }
        return format(Array(raw))
    }

    private static func format(_ c: [Character]) -> String {
        let groups = [c[0..<6], c[6..<11], c[11..<16], c[16..<21], c[21...]].map { String($0) }
        return "SR1-" + groups.joined(separator: "-")
    }
}
