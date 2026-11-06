public enum RecordKind: String, Codable, Sendable {
    case vault, collection, item
}

/// One encrypted vault, collection or item, as stored on disk and on the sync server.
public struct SealedRecord: Codable, Equatable, Sendable {
    public var id: String
    public var kind: RecordKind
    /// Server revision this record was last synced at; 0 if never.
    public var rev: Int
    public var updatedAt: Int64
    /// Changed locally since the last sync. The server leaves it out.
    public var dirty: Bool
    public var deleted: Bool?
    public var data: Sealed?

    public init(id: String, kind: RecordKind, rev: Int, updatedAt: Int64, dirty: Bool, deleted: Bool? = nil, data: Sealed? = nil) {
        self.id = id
        self.kind = kind
        self.rev = rev
        self.updatedAt = updatedAt
        self.dirty = dirty
        self.deleted = deleted
        self.data = data
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        kind = try c.decode(RecordKind.self, forKey: .kind)
        rev = try c.decodeIfPresent(Int.self, forKey: .rev) ?? 0
        updatedAt = try c.decodeIfPresent(Int64.self, forKey: .updatedAt) ?? 0
        dirty = try c.decodeIfPresent(Bool.self, forKey: .dirty) ?? false
        deleted = try c.decodeIfPresent(Bool.self, forKey: .deleted)
        data = try c.decodeIfPresent(Sealed.self, forKey: .data)
    }

    public var isDeleted: Bool { deleted == true }

    /// Internal format labels keep the app's earlier name (Strongroom).
    public static func aad(_ kind: RecordKind, _ id: String) -> String { "strongroom:record:v2:\(kind.rawValue):\(id)" }
}
