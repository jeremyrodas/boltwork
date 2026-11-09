/// The little CBOR WebAuthn needs: integers, byte and text strings, and maps with keys in canonical order.
indirect enum CBOR {
    case int(Int)
    case bytes([UInt8])
    case text(String)
    case map([(CBOR, CBOR)])

    var encoded: [UInt8] {
        switch self {
        case .int(let n): n >= 0 ? Self.head(0, UInt64(n)) : Self.head(1, UInt64(-1 - n))
        case .bytes(let b): Self.head(2, UInt64(b.count)) + b
        case .text(let s): Self.head(3, UInt64(s.utf8.count)) + Array(s.utf8)
        case .map(let entries): Self.head(5, UInt64(entries.count)) + entries.flatMap { $0.0.encoded + $0.1.encoded }
        }
    }

    private static func head(_ major: UInt8, _ n: UInt64) -> [UInt8] {
        let m = major << 5
        switch n {
        case ..<24: return [m | UInt8(n)]
        case ..<0x100: return [m | 24, UInt8(n)]
        case ..<0x10000: return [m | 25, UInt8(n >> 8), UInt8(n & 0xFF)]
        default: return [m | 26] + (0..<4).reversed().map { UInt8((n >> (8 * UInt64($0))) & 0xFF) }
        }
    }
}
