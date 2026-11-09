/// A vault inside the account (Personal, Work, …), not the encrypted file.
public struct Vault: Codable, Equatable, Hashable, Identifiable, Sendable {
    public var id: String
    public var name: String
    public var description: String
    public var icon: String
    public var color: String
    public var createdAt: Int64

    public init(id: String, name: String, description: String = "", icon: String = "folder", color: String = "#8b5cf6", createdAt: Int64) {
        self.id = id
        self.name = name
        self.description = description
        self.icon = icon
        self.color = color
        self.createdAt = createdAt
    }
}

public struct VaultCollection: Codable, Equatable, Hashable, Identifiable, Sendable {
    public var id: String
    public var name: String
    public var vaultIds: [String]
}
