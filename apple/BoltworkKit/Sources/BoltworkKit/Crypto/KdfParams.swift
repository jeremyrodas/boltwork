/// Argon2id parameters stored in the vault header. `mem` is in bytes.
public struct KdfParams: Codable, Equatable, Sendable {
    public var alg: String
    public var salt: String
    public var ops: Int
    public var mem: Int
}

public struct KdfCost: Sendable {
    public var ops: Int
    public var mem: Int
}
