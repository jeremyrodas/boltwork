/// Where this vault syncs to. Not secret: the server only ever sees sealed records.
public struct SyncState: Codable, Equatable, Sendable {
    public var serverUrl: String
    public var email: String
    /// Highest server revision this device has pulled.
    public var cursor: Int
    public var lastSyncAt: Int64?
    /// Another address for the same server, used when `serverUrl` can't be reached (say, a VPN address
    /// for when you're away from home). Set per device; apps that don't know it ignore it.
    public var backupUrl: String?

    public init(serverUrl: String, email: String, cursor: Int = 0, lastSyncAt: Int64? = nil, backupUrl: String? = nil) {
        self.serverUrl = serverUrl
        self.email = email
        self.cursor = cursor
        self.lastSyncAt = lastSyncAt
        self.backupUrl = backupUrl
    }

    /// The addresses to try, main first.
    public var addresses: [String] { [serverUrl] + (backupUrl.map { [$0] } ?? []) }
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
