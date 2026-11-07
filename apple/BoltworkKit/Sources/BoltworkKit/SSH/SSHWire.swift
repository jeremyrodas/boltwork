/// The SSH wire encoding (RFC 4251): big-endian lengths, strings and mpints.
enum SSHWire {
    struct Truncated: Error {}

    static func u32(_ n: Int) -> [UInt8] { [UInt8(n >> 24 & 0xFF), UInt8(n >> 16 & 0xFF), UInt8(n >> 8 & 0xFF), UInt8(n & 0xFF)] }
    static func string(_ b: [UInt8]) -> [UInt8] { u32(b.count) + b }
    static func string(_ s: String) -> [UInt8] { string(Array(s.utf8)) }

    static func mpint(_ b: [UInt8]) -> [UInt8] {
        var v = ArraySlice(b)
        while v.count > 1, v.first == 0, v[v.startIndex + 1] & 0x80 == 0 { v = v.dropFirst() }
        return string((v.first ?? 0) & 0x80 != 0 ? [0] + v : Array(v))
    }

    struct Reader {
        private let bytes: [UInt8]
        private var offset = 0
        init(_ bytes: [UInt8]) { self.bytes = bytes }
        var remaining: Int { bytes.count - offset }

        mutating func take(_ n: Int) throws -> [UInt8] {
            guard n >= 0, remaining >= n else { throw Truncated() }
            defer { offset += n }
            return Array(bytes[offset..<offset + n])
        }
        mutating func u8() throws -> UInt8 { try take(1)[0] }
        mutating func u32() throws -> Int { try take(4).reduce(0) { $0 << 8 | Int($1) } }
        mutating func string() throws -> [UInt8] { try take(u32()) }
        mutating func text() throws -> String { String(decoding: try string(), as: UTF8.self) }
        mutating func mpint() throws -> [UInt8] { let v = try string(); return v.first == 0 ? Array(v.dropFirst()) : v }
    }
}
