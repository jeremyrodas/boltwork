/// A sealed blob: base64 nonce and base64 ciphertext-with-tag.
public struct Sealed: Codable, Equatable, Sendable {
    public var n: String
    public var c: String
}
