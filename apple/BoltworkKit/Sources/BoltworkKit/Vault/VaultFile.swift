/// Where this vault syncs to. Not secret: the server only ever sees sealed records.
public struct SyncState: Codable, Equatable, Sendable {
    public var serverUrl: String
    public var email: String
    /// Highest server revision this device has pulled.
    public var cursor: Int
    public var lastSyncAt: Int64?
}

/// `vault.json`, format version 2 (see `src/core/store.ts`).
struct VaultFile: Codable {
    static let format = "strongroom-vault"
    static let version = 2

    var format: String
    var version: Int
    var accountId: String?
    var kdf: KdfParams
    var wrappedKey: Sealed
    var records: [SealedRecord]?
    var local: Sealed?
    var sync: SyncState?
    var savedAt: Int64?
    /// Version 1 only: everything in one sealed blob.
    var data: Sealed?
}

/// Device-local data sealed apart from the records.
struct LocalData: Codable {
    var pwnedCache: [String: Int]?
    var searchHistory: [String]?
}

/// The whole vault as one value (version 1 files).
struct LegacyVaultData: Codable {
    var vaults: [Vault]
    var items: [Item]
    var collections: [VaultCollection]?
    var pwnedCache: [String: Int]?
    var searchHistory: [String]?
}
