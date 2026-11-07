public enum ItemState: String, Codable, Sendable {
    case active, archived, deleted
}

/// A vault item, as stored in an encrypted record. Fields this app doesn't model (passkeys, for example) are kept in `extras`.
public struct Item: Codable, Equatable, Hashable, Identifiable, Sendable {
    public var id: String
    public var vaultId: String
    public var content: ItemContent
    public var favorite: Bool
    public var state: ItemState
    public var createdAt: Int64
    public var updatedAt: Int64
    public var deletedAt: Int64?
    public var lastUsedAt: Int64?
    public var useCount: Int
    public var passwordChangedAt: Int64?
    public var attachments: [Attachment]
    public var history: [ItemVersion]
    public var watchtowerIgnore: [String]
    public var extras: [String: JSONValue]

    public var title: String { content.title }
    public var category: ItemCategory { content.category }
    /// How many passkeys the item holds.
    public var passkeyCount: Int { extras["passkeys"]?.arrayValue?.count ?? 0 }

    public init(id: String, vaultId: String, content: ItemContent, createdAt: Int64) {
        self.id = id
        self.vaultId = vaultId
        self.content = content
        favorite = false
        state = .active
        self.createdAt = createdAt
        updatedAt = createdAt
        useCount = 0
        attachments = []
        history = []
        watchtowerIgnore = []
        extras = [:]
    }

    private static let ownKeys: Set<String> = [
        "id", "vaultId", "favorite", "state", "createdAt", "updatedAt", "deletedAt", "lastUsedAt", "useCount",
        "passwordChangedAt", "attachments", "history", "watchtowerIgnore",
        "category", "title", "urls", "fields", "sections", "notes", "tags", "icon", "autosubmit"
    ]

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: AnyKey.self)
        content = try ItemContent(from: decoder)
        id = try c.decode(String.self, forKey: AnyKey("id"))
        vaultId = try c.decode(String.self, forKey: AnyKey("vaultId"))
        favorite = try c.decodeIfPresent(Bool.self, forKey: AnyKey("favorite")) ?? false
        state = try c.decodeIfPresent(ItemState.self, forKey: AnyKey("state")) ?? .active
        createdAt = try c.decodeIfPresent(Int64.self, forKey: AnyKey("createdAt")) ?? 0
        updatedAt = try c.decodeIfPresent(Int64.self, forKey: AnyKey("updatedAt")) ?? createdAt
        deletedAt = try c.decodeIfPresent(Int64.self, forKey: AnyKey("deletedAt"))
        lastUsedAt = try c.decodeIfPresent(Int64.self, forKey: AnyKey("lastUsedAt"))
        useCount = try c.decodeIfPresent(Int.self, forKey: AnyKey("useCount")) ?? 0
        passwordChangedAt = try c.decodeIfPresent(Int64.self, forKey: AnyKey("passwordChangedAt"))
        attachments = try c.decodeIfPresent([Attachment].self, forKey: AnyKey("attachments")) ?? []
        history = try c.decodeIfPresent([ItemVersion].self, forKey: AnyKey("history")) ?? []
        watchtowerIgnore = try c.decodeIfPresent([String].self, forKey: AnyKey("watchtowerIgnore")) ?? []
        extras = try c.extras(excluding: Self.ownKeys)
    }

    public func encode(to encoder: Encoder) throws {
        try content.encode(to: encoder)
        var c = encoder.container(keyedBy: AnyKey.self)
        try c.encode(id, forKey: AnyKey("id"))
        try c.encode(vaultId, forKey: AnyKey("vaultId"))
        try c.encode(favorite, forKey: AnyKey("favorite"))
        try c.encode(state, forKey: AnyKey("state"))
        try c.encode(createdAt, forKey: AnyKey("createdAt"))
        try c.encode(updatedAt, forKey: AnyKey("updatedAt"))
        try c.encodeIfPresent(deletedAt, forKey: AnyKey("deletedAt"))
        try c.encodeIfPresent(lastUsedAt, forKey: AnyKey("lastUsedAt"))
        try c.encode(useCount, forKey: AnyKey("useCount"))
        try c.encodeIfPresent(passwordChangedAt, forKey: AnyKey("passwordChangedAt"))
        try c.encode(attachments, forKey: AnyKey("attachments"))
        try c.encode(history, forKey: AnyKey("history"))
        try c.encode(watchtowerIgnore, forKey: AnyKey("watchtowerIgnore"))
        try c.encodeExtras(extras)
    }
}
