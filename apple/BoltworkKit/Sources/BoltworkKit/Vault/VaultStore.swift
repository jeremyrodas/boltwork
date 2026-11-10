import Foundation

/// The encrypted vault on disk, compatible with the desktop app's `vault.json` (see `src/core/store.ts`).
///
///     <dir>/vault.json          header + wrapped master key + one sealed record per vault, collection and item
///     <dir>/vault.json.bak      previous good copy
///     <dir>/attachments/<id>    each attachment sealed separately
///
/// Key derivation (Argon2id) is slow, so it lives in the static `@concurrent` functions; everything
/// else is quick and runs wherever the store is owned.
public final class VaultStore {
    static let aadKey = "strongroom:master-key:v1"
    static let aadData = "strongroom:vault-data:v1"
    static let aadLocal = "strongroom:local-data:v2"
    static func aadAttachment(_ id: String) -> String { "strongroom:attachment:v1:\(id)" }
    /// Boltwork 0.1–0.2 could seal data with an all-zero key after a quick unlock; such data is re-sealed on unlock.
    static let blankKey = [UInt8](repeating: 0, count: 32)
    public static let maxAttachmentSize = 100 * 1024 * 1024

    public let directory: URL
    public private(set) var accountId: String
    public var syncState: SyncState?
    public var historyLimit = 30

    private var kdf: KdfParams
    private var wrappedKey: Sealed
    private var key: [UInt8]?
    var records: RecordSet

    public private(set) var vaults: [Vault] = []
    public private(set) var collections: [VaultCollection] = []
    public private(set) var items: [Item] = []
    public private(set) var searchHistory: [String] = []
    private var pwnedCache: [String: Int] = [:]
    /// Records and attachments re-sealed on unlock because they were sealed with the blank key.
    public private(set) var repairedBlankKey = 0

    private var vaultURL: URL { directory.appending(path: "vault.json") }
    /// The file's modification date when this store last read or wrote it.
    private var fileDate: Date?

    private static func modificationDate(_ directory: URL) -> Date? {
        try? FileManager.default.attributesOfItem(atPath: directory.appending(path: "vault.json").path)[.modificationDate] as? Date
    }

    /// Whether another process (the AutoFill extension) has saved the vault since this store last did.
    public var changedOnDisk: Bool { Self.modificationDate(directory) != fileDate }
    private var attachmentsURL: URL { directory.appending(path: "attachments") }

    private init(directory: URL, kdf: KdfParams, wrappedKey: Sealed, key: [UInt8], accountId: String, records: RecordSet = RecordSet()) {
        self.directory = directory
        self.kdf = kdf
        self.wrappedKey = wrappedKey
        self.key = key
        self.accountId = accountId
        self.records = records
    }

    public static func exists(at directory: URL) -> Bool {
        FileManager.default.fileExists(atPath: directory.appending(path: "vault.json").path)
    }

    // MARK: - Creating and unlocking

    /// Creates a new vault with one "Personal" vault inside.
    @concurrent
    public static func create(at directory: URL, password: String, secretKey: String, cost: KdfCost = VaultCrypto.strongCost) async throws -> CreatedVault {
        if exists(at: directory) { throw VaultError.vaultExists }
        guard password.count >= 8 else { throw VaultError.passwordTooShort }
        let kdf = VaultCrypto.newKdfParams(cost: cost)
        var kek = try VaultCrypto.deriveKek(password: password, secretKey: secretKey, kdf: kdf)
        defer { VaultCrypto.wipe(&kek) }
        let key = VaultCrypto.randomKey()
        let wrapped = try VaultCrypto.sealJSON(key.map(Int.init), key: kek, aad: aadKey)
        return CreatedVault(kdf: kdf, wrappedKey: wrapped, key: key)
    }

    /// Finishes `create` on the caller's side.
    public static func open(created: CreatedVault, at directory: URL) throws -> VaultStore {
        try FileManager.default.createDirectory(at: directory.appending(path: "attachments"), withIntermediateDirectories: true)
        let store = VaultStore(directory: directory, kdf: created.kdf, wrappedKey: created.wrappedKey, key: created.key, accountId: VaultCrypto.randomId())
        store.vaults = [Vault(id: VaultCrypto.randomId(), name: "Personal", description: "Your private vault", icon: "house", color: "#3b82f6", createdAt: Self.now())]
        try store.persist()
        return store
    }

    /// Unwraps the master key with password + Secret Key. Slow: runs Argon2id.
    @concurrent
    public static func masterKey(at directory: URL, password: String, secretKey: String) async throws -> [UInt8] {
        let file = try readFile(directory)
        return try unwrap(wrappedKey: file.wrappedKey, kdf: file.kdf, password: password, secretKey: secretKey)
    }

    static func unwrap(wrappedKey: Sealed, kdf: KdfParams, password: String, secretKey: String) throws -> [UInt8] {
        var kek = try VaultCrypto.deriveKek(password: password, secretKey: secretKey, kdf: kdf)
        defer { VaultCrypto.wipe(&kek) }
        do {
            return try VaultCrypto.openJSON([Int].self, from: wrappedKey, key: kek, aad: aadKey).map { UInt8(truncatingIfNeeded: $0) }
        } catch {
            throw VaultError.wrongPassword
        }
    }

    /// Opens the vault with its master key (from `masterKey(at:…)`, or quick unlock after checking it's right).
    public static func open(at directory: URL, key: [UInt8]) throws -> VaultStore {
        let date = modificationDate(directory)
        let file = try readFile(directory)
        if file.version == 1 {
            guard let blob = file.data else { throw VaultError.unsupportedFormat }
            let data = try VaultCrypto.openJSON(LegacyVaultData.self, from: blob, key: key, aad: aadData)
            let backup = directory.appending(path: "vault.v1-backup.json")
            if !FileManager.default.fileExists(atPath: backup.path) {
                try FileManager.default.copyItem(at: directory.appending(path: "vault.json"), to: backup)
            }
            let store = VaultStore(directory: directory, kdf: file.kdf, wrappedKey: file.wrappedKey, key: key, accountId: VaultCrypto.randomId())
            store.vaults = data.vaults
            store.items = data.items
            store.collections = data.collections ?? []
            store.pwnedCache = data.pwnedCache ?? [:]
            store.searchHistory = data.searchHistory ?? []
            try store.persist()
            return store
        }

        try checkKey(file, key: key)
        let opened = try RecordSet.open(key: key, sealed: file.records ?? [], fallbackKey: blankKey)
        var local = LocalData()
        var localRecovered = false
        if let sealedLocal = file.local {
            if let l = try? VaultCrypto.openJSON(LocalData.self, from: sealedLocal, key: key, aad: aadLocal) {
                local = l
            } else if let l = try? VaultCrypto.openJSON(LocalData.self, from: sealedLocal, key: blankKey, aad: aadLocal) {
                local = l
                localRecovered = true
            }
        }
        let store = VaultStore(directory: directory, kdf: file.kdf, wrappedKey: file.wrappedKey, key: key,
                               accountId: file.accountId ?? VaultCrypto.randomId(), records: opened.set)
        store.vaults = opened.vaults.sorted { $0.createdAt < $1.createdAt }
        store.collections = opened.collections
        store.items = opened.items
        store.pwnedCache = local.pwnedCache ?? [:]
        store.searchHistory = local.searchHistory ?? []
        store.syncState = file.sync
        store.fileDate = date
        if !opened.recovered.isEmpty || localRecovered {
            store.repairedBlankKey = opened.recovered.count + store.resealBlankAttachments()
            try store.persist()
        }
        return store
    }

    /// Throws unless `key` is this vault's master key.
    private static func checkKey(_ file: VaultFile, key: [UInt8]) throws {
        if let local = file.local, (try? VaultCrypto.open(local, key: key, aad: aadLocal)) != nil { return }
        for r in file.records ?? [] {
            guard let data = r.data else { continue }
            if (try? VaultCrypto.open(data, key: key, aad: SealedRecord.aad(r.kind, r.id))) != nil { return }
        }
        if file.records?.contains(where: { $0.data != nil }) == false && file.local == nil { return }
        throw VaultError.wrongPassword
    }

    /// Sets up this device from a sync server's keyset. The first sync pulls everything.
    @concurrent
    public static func masterKey(fromRemote keyset: Keyset, password: String, secretKey: String) async throws -> [UInt8] {
        try unwrap(wrappedKey: keyset.wrappedKey, kdf: keyset.kdf, password: password, secretKey: secretKey)
    }

    public static func createFromRemote(at directory: URL, keyset: Keyset, key: [UInt8], sync: SyncState) throws -> VaultStore {
        if exists(at: directory) { throw VaultError.vaultExists }
        try FileManager.default.createDirectory(at: directory.appending(path: "attachments"), withIntermediateDirectories: true)
        let store = VaultStore(directory: directory, kdf: keyset.kdf, wrappedKey: keyset.wrappedKey, key: key, accountId: keyset.accountId)
        store.syncState = sync
        try store.writeFile()
        return store
    }

    static func readFile(_ directory: URL) throws -> VaultFile {
        let data = try Data(contentsOf: directory.appending(path: "vault.json"))
        guard let file = try? JSONCoding.decoder.decode(VaultFile.self, from: data), file.format == VaultFile.format else {
            throw VaultError.unsupportedFormat
        }
        if file.version > VaultFile.version { throw VaultError.newerVersion }
        return file
    }

    /// The vault's account id without unlocking it.
    public static func peekAccountId(at directory: URL) -> String? {
        try? readFile(directory).accountId
    }

    /// What a sync server keeps so new devices can unlock. Safe to share.
    public var keyset: Keyset { Keyset(kdf: kdf, wrappedKey: wrappedKey, accountId: accountId) }

    /// Derives the sync sign-in key, checking the password first. Slow: runs Argon2id.
    @concurrent
    public static func authKey(keyset: Keyset, password: String, secretKey: String) async throws -> [UInt8] {
        var kek = try VaultCrypto.deriveKek(password: password, secretKey: secretKey, kdf: keyset.kdf)
        defer { VaultCrypto.wipe(&kek) }
        guard (try? VaultCrypto.open(keyset.wrappedKey, key: kek, aad: aadKey)) != nil else { throw VaultError.wrongPassword }
        return VaultCrypto.authKey(fromKek: kek)
    }

    /// A new keyset for a changed account password. Slow: runs Argon2id twice.
    @concurrent
    public static func rewrap(keyset: Keyset, masterKey: [UInt8], oldPassword: String, newPassword: String, secretKey: String) async throws -> (Keyset, authKey: [UInt8]) {
        _ = try unwrap(wrappedKey: keyset.wrappedKey, kdf: keyset.kdf, password: oldPassword, secretKey: secretKey)
        guard newPassword.count >= 8 else { throw VaultError.passwordTooShort }
        let kdf = VaultCrypto.newKdfParams(cost: KdfCost(ops: keyset.kdf.ops, mem: keyset.kdf.mem))
        var kek = try VaultCrypto.deriveKek(password: newPassword, secretKey: secretKey, kdf: kdf)
        defer { VaultCrypto.wipe(&kek) }
        let wrapped = try VaultCrypto.sealJSON(masterKey.map(Int.init), key: kek, aad: aadKey)
        return (Keyset(kdf: kdf, wrappedKey: wrapped, accountId: keyset.accountId), VaultCrypto.authKey(fromKek: kek))
    }

    public func adopt(keyset: Keyset) throws {
        kdf = keyset.kdf
        wrappedKey = keyset.wrappedKey
        try writeFile()
    }

    // MARK: - Locking and saving

    public var isLocked: Bool { key == nil }

    /// A copy of the master key, for quick unlock to protect on this device.
    public func masterKeyCopy() throws -> [UInt8] { try requireKey() }

    public func lock() {
        if var k = key { VaultCrypto.wipe(&k) }
        key = nil
        vaults = []
        collections = []
        items = []
        searchHistory = []
        pwnedCache = [:]
    }

    private func requireKey() throws -> [UInt8] {
        guard let key else { throw VaultError.locked }
        return key
    }

    static func now() -> Int64 { Int64((Date().timeIntervalSince1970 * 1000).rounded()) }

    public func persist() throws {
        let key = try requireKey()
        try records.update(key: key, vaults: vaults, collections: collections, items: items, now: Self.now())
        try writeFile()
    }

    /// Writes the records atomically, keeping the previous file as `.bak`.
    public func writeFile() throws {
        let key = try requireKey()
        let local = try VaultCrypto.sealJSON(LocalData(pwnedCache: pwnedCache, searchHistory: searchHistory), key: key, aad: Self.aadLocal)
        let file = VaultFile(format: VaultFile.format, version: VaultFile.version, accountId: accountId, kdf: kdf, wrappedKey: wrappedKey,
                             records: records.all, local: local, sync: syncState, savedAt: Self.now())
        let data = try JSONCoding.encode(file)
        let fm = FileManager.default
        try fm.createDirectory(at: directory, withIntermediateDirectories: true)
        if fm.fileExists(atPath: vaultURL.path) {
            let bak = directory.appending(path: "vault.json.bak")
            try? fm.removeItem(at: bak)
            try fm.copyItem(at: vaultURL, to: bak)
        }
        try data.write(to: vaultURL, options: [.atomic, .completeFileProtection])
        fileDate = Self.modificationDate(directory)
    }

    // MARK: - Vaults and collections

    @discardableResult
    public func saveVault(_ vault: Vault) throws -> Vault {
        _ = try requireKey()
        if let i = vaults.firstIndex(where: { $0.id == vault.id }) { vaults[i] = vault } else { vaults.append(vault) }
        try persist()
        return vault
    }

    public func deleteVault(id: String, moveItemsTo: String? = nil) throws {
        _ = try requireKey()
        guard vaults.count > 1 else { throw VaultError.lastVault }
        if let target = moveItemsTo {
            guard vaults.contains(where: { $0.id == target }) else { throw VaultError.notFound("Destination vault") }
            for i in items.indices where items[i].vaultId == id { items[i].vaultId = target }
        } else {
            items.filter { $0.vaultId == id }.forEach(removeAttachmentFiles)
            items.removeAll { $0.vaultId == id }
        }
        vaults.removeAll { $0.id == id }
        for i in collections.indices { collections[i].vaultIds.removeAll { $0 == id } }
        try persist()
    }

    // MARK: - Items

    public func item(id: String) throws -> Item {
        _ = try requireKey()
        guard let item = items.first(where: { $0.id == id }) else { throw VaultError.notFound("Item") }
        return item
    }

    /// Creates an item (`id` nil) or updates one, keeping the previous content in its history.
    @discardableResult
    public func saveItem(id: String?, vaultId: String, content input: ItemContent) throws -> Item {
        _ = try requireKey()
        guard vaults.contains(where: { $0.id == vaultId }) else { throw VaultError.notFound("Vault") }
        let now = Self.now()
        var content = input
        content.title = content.title.trimmingCharacters(in: .whitespacesAndNewlines)
        if content.title.isEmpty { content.title = "Untitled" }
        var seen = Set<String>()
        content.tags = content.tags.map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty && seen.insert($0).inserted }

        guard let id, let index = items.firstIndex(where: { $0.id == id }) else {
            var item = Item(id: VaultCrypto.randomId(), vaultId: vaultId, content: content, createdAt: now)
            if content.field(for: .password) != nil { item.passwordChangedAt = now }
            items.append(item)
            try persist()
            return item
        }
        var existing = items[index]
        let before = existing.content
        if before != content || existing.vaultId != vaultId {
            existing.history.insert(ItemVersion(savedAt: existing.updatedAt, content: before), at: 0)
            existing.history = Array(existing.history.prefix(historyLimit))
            if before.field(for: .password)?.value != content.field(for: .password)?.value { existing.passwordChangedAt = now }
            existing.content = content
            existing.vaultId = vaultId
            existing.updatedAt = now
            items[index] = existing
            try persist()
        }
        return existing
    }

    @discardableResult
    public func duplicateItem(id: String) throws -> Item {
        let src = try item(id: id)
        var content = src.content
        content.title = "\(src.title) (copy)"
        return try saveItem(id: nil, vaultId: src.vaultId, content: content)
    }

    @discardableResult
    public func restoreVersion(itemId: String, index: Int) throws -> Item {
        let item = try item(id: itemId)
        guard item.history.indices.contains(index) else { throw VaultError.notFound("That version") }
        return try saveItem(id: item.id, vaultId: item.vaultId, content: item.history[index].content)
    }

    @discardableResult
    func patch(_ id: String, touch: Bool = true, _ change: (inout Item) -> Void) throws -> Item {
        _ = try requireKey()
        guard let i = items.firstIndex(where: { $0.id == id }) else { throw VaultError.notFound("Item") }
        change(&items[i])
        if touch { items[i].updatedAt = Self.now() }
        try persist()
        return items[i]
    }

    public func setFavorite(_ id: String, _ favorite: Bool) throws { try patch(id, touch: false) { $0.favorite = favorite } }
    public func archive(_ id: String) throws { try patch(id) { $0.state = .archived } }
    public func trash(_ id: String) throws { try patch(id) { $0.state = .deleted; $0.deletedAt = Self.now() } }
    public func restore(_ id: String) throws { try patch(id) { $0.state = .active; $0.deletedAt = nil } }
    public func markUsed(_ id: String) throws { try patch(id, touch: false) { $0.useCount += 1; $0.lastUsedAt = Self.now() } }
    public func move(_ id: String, toVault vaultId: String) throws {
        guard vaults.contains(where: { $0.id == vaultId }) else { throw VaultError.notFound("Vault") }
        try patch(id) { $0.vaultId = vaultId }
    }

    /// Permanently deletes an item and its attachments.
    public func purge(_ id: String) throws {
        let item = try item(id: id)
        removeAttachmentFiles(item)
        items.removeAll { $0.id == id }
        try persist()
    }

    /// Permanently deletes items in Recently Deleted older than `days` (0 = all of them).
    @discardableResult
    public func emptyTrash(olderThanDays days: Int = 0) throws -> Int {
        _ = try requireKey()
        let cutoff = Self.now() - Int64(days) * 86_400_000
        let doomed = items.filter { $0.state == .deleted && (days == 0 || ($0.deletedAt ?? 0) < cutoff) }
        doomed.forEach(removeAttachmentFiles)
        let ids = Set(doomed.map(\.id))
        items.removeAll { ids.contains($0.id) }
        if !doomed.isEmpty { try persist() }
        return doomed.count
    }

    /// Have I Been Pwned results by password SHA-1, kept encrypted on this device only.
    public var pwnedCounts: [String: Int] { pwnedCache }

    public func recordPwned(sha1: String, count: Int) {
        pwnedCache[sha1] = count
    }

    public func addSearchHistory(_ query: String) throws {
        _ = try requireKey()
        let q = query.trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty else { return }
        searchHistory = Array(([q] + searchHistory.filter { $0 != q }).prefix(20))
        try writeFile()
    }

    // MARK: - Sync merge

    public enum MergeResult { case skipped, applied, conflict }

    /// Applies a record from the sync server. If both sides changed it, the newer change wins and,
    /// for items, the other version goes into the item's history.
    @discardableResult
    public func mergeRemote(_ r: SealedRecord) throws -> MergeResult {
        let key = try requireKey()
        let local = records[r.id]
        if let local, local.rev >= r.rev { return .skipped }

        switch r.kind {
        case .vault:
            let remote = try decodeRemote(Vault.self, r, key)
            return try merge(r, local: local, remote: remote, key: key, list: \.vaults, combine: nil)
        case .collection:
            let remote = try decodeRemote(VaultCollection.self, r, key)
            return try merge(r, local: local, remote: remote, key: key, list: \.collections, combine: nil)
        case .item:
            let remote = try decodeRemote(Item.self, r, key)
            return try merge(r, local: local, remote: remote, key: key, list: \.items, combine: withHistory)
        }
    }

    private func decodeRemote<T: Decodable>(_ type: T.Type, _ r: SealedRecord, _ key: [UInt8]) throws -> T? {
        guard !r.isDeleted, let data = r.data else { return nil }
        return try VaultCrypto.openJSON(type, from: data, key: key, aad: SealedRecord.aad(r.kind, r.id))
    }

    private func merge<T: Codable & Identifiable>(
        _ r: SealedRecord, local: SealedRecord?, remote: T?, key: [UInt8],
        list: ReferenceWritableKeyPath<VaultStore, [T]>, combine: ((T, T) -> T)?
    ) throws -> MergeResult where T.ID == String {
        let mine = self[keyPath: list].first { $0.id == r.id }
        func replace(_ value: T?) {
            if let i = self[keyPath: list].firstIndex(where: { $0.id == r.id }) {
                if let value { self[keyPath: list][i] = value } else { self[keyPath: list].remove(at: i) }
            } else if let value {
                self[keyPath: list].append(value)
            }
            vaults.sort { $0.createdAt < $1.createdAt }
        }
        guard let local, local.dirty else {
            replace(remote)
            records.putRemote(r, plaintext: remote)
            return .applied
        }
        if r.updatedAt > local.updatedAt {
            var merged = remote
            if let combine, let remote, let mine { merged = combine(remote, mine) }
            replace(merged)
            records.putRemote(r, plaintext: remote)
        } else {
            if let combine, let remote, let mine { replace(combine(mine, remote)) }
            records.adoptRev(id: r.id, rev: r.rev)
        }
        try records.update(key: key, vaults: vaults, collections: collections, items: items, now: Self.now())
        return .conflict
    }

    private func withHistory(winner: Item, loser: Item) -> Item {
        var w = winner
        w.history = Array(([ItemVersion(savedAt: loser.updatedAt, content: loser.content)] + w.history).prefix(historyLimit))
        let have = Set(w.attachments.map(\.id))
        w.attachments += loser.attachments.filter { !have.contains($0.id) }
        // Keep the other side's passkeys too: losing one would lock the user out of that site.
        if case .array(let theirs)? = loser.extras["passkeys"] {
            let mine = w.extras["passkeys"]?.arrayValue ?? []
            let ids = Set(mine.compactMap { if case .object(let o) = $0, case .string(let s)? = o["credentialId"] { s } else { nil } })
            let extra = theirs.filter { if case .object(let o) = $0, case .string(let s)? = o["credentialId"] { !ids.contains(s) } else { false } }
            if !extra.isEmpty { w.extras["passkeys"] = .array(mine + extra) }
        }
        return w
    }

    /// Records changed here since the last sync.
    public var dirtyRecords: [SealedRecord] { records.dirty }

    public func markSynced(id: String, rev: Int, updatedAt: Int64) { records.markSynced(id: id, rev: rev, updatedAt: updatedAt) }

    /// Forgets server revisions after sync is turned off, so a later setup (maybe to another server) uploads everything again.
    public func forgetServerRevisions() { records.forgetServerRevisions() }

    // MARK: - Attachments

    private func attachmentURL(_ id: String) -> URL { attachmentsURL.appending(path: id) }

    @discardableResult
    public func addAttachment(itemId: String, name: String, mime: String, bytes: Data) throws -> Attachment {
        let key = try requireKey()
        guard bytes.count <= Self.maxAttachmentSize else { throw VaultError.attachmentTooLarge }
        let att = Attachment(id: VaultCrypto.randomId(), name: name, size: bytes.count, mime: mime, addedAt: Self.now())
        try FileManager.default.createDirectory(at: attachmentsURL, withIntermediateDirectories: true)
        let sealed = try VaultCrypto.seal([UInt8](bytes), key: key, aad: Self.aadAttachment(att.id))
        try JSONCoding.encode(sealed).write(to: attachmentURL(att.id), options: [.atomic, .completeFileProtection])
        try patch(itemId) { $0.attachments.append(att) }
        return att
    }

    public func readAttachment(itemId: String, attachmentId: String) throws -> (Attachment, Data) {
        let key = try requireKey()
        guard let meta = try item(id: itemId).attachments.first(where: { $0.id == attachmentId }) else { throw VaultError.notFound("Attachment") }
        guard hasAttachmentFile(meta.id) else { throw syncState != nil ? VaultError.attachmentNotDownloaded : VaultError.notFound("Attachment file") }
        let sealed = try JSONCoding.decoder.decode(Sealed.self, from: Data(contentsOf: attachmentURL(meta.id)))
        return (meta, Data(try VaultCrypto.open(sealed, key: key, aad: Self.aadAttachment(meta.id))))
    }

    public func removeAttachment(itemId: String, attachmentId: String) throws {
        try patch(itemId) { $0.attachments.removeAll { $0.id == attachmentId } }
        try? FileManager.default.removeItem(at: attachmentURL(attachmentId))
    }

    private func removeAttachmentFiles(_ item: Item) {
        for a in item.attachments { try? FileManager.default.removeItem(at: attachmentURL(a.id)) }
    }

    /// Ids of every attachment some item refers to.
    public var referencedAttachmentIds: Set<String> { Set(items.flatMap { $0.attachments.map(\.id) }) }

    public func hasAttachmentFile(_ id: String) -> Bool { FileManager.default.fileExists(atPath: attachmentURL(id).path) }

    public func readAttachmentBlob(_ id: String) throws -> Data { try Data(contentsOf: attachmentURL(id)) }

    /// Stores a sealed file from the sync server after checking it opens as the attachment it claims to be.
    public func writeAttachmentBlob(_ id: String, _ blob: Data) throws {
        let key = try requireKey()
        guard referencedAttachmentIds.contains(id) else { throw VaultError.notFound("Attachment") }
        let sealed = try JSONCoding.decoder.decode(Sealed.self, from: blob)
        var plain = try VaultCrypto.open(sealed, key: key, aad: Self.aadAttachment(id))
        VaultCrypto.wipe(&plain)
        try FileManager.default.createDirectory(at: attachmentsURL, withIntermediateDirectories: true)
        try blob.write(to: attachmentURL(id), options: [.atomic, .completeFileProtection])
    }

    /// Deletes files no item refers to any more.
    @discardableResult
    public func removeUnreferencedAttachmentFiles() -> Int {
        let keep = referencedAttachmentIds
        let names = (try? FileManager.default.contentsOfDirectory(atPath: attachmentsURL.path)) ?? []
        var removed = 0
        for name in names where !keep.contains(name) {
            try? FileManager.default.removeItem(at: attachmentURL(name))
            if !name.hasSuffix(".tmp") { removed += 1 }
        }
        return removed
    }

    private func resealBlankAttachments() -> Int {
        guard let key else { return 0 }
        var n = 0
        for id in referencedAttachmentIds where hasAttachmentFile(id) {
            guard let sealed = try? JSONCoding.decoder.decode(Sealed.self, from: Data(contentsOf: attachmentURL(id))) else { continue }
            if (try? VaultCrypto.open(sealed, key: key, aad: Self.aadAttachment(id))) != nil { continue }
            guard let bytes = try? VaultCrypto.open(sealed, key: Self.blankKey, aad: Self.aadAttachment(id)),
                  let resealed = try? VaultCrypto.seal(bytes, key: key, aad: Self.aadAttachment(id)),
                  let data = try? JSONCoding.encode(resealed) else { continue }
            try? data.write(to: attachmentURL(id), options: [.atomic, .completeFileProtection])
            n += 1
        }
        return n
    }
}

/// The KDF parameters and wrapped master key a sync server holds for new devices.
public struct Keyset: Codable, Sendable {
    public var kdf: KdfParams
    public var wrappedKey: Sealed
    public var accountId: String

    public init(kdf: KdfParams, wrappedKey: Sealed, accountId: String) {
        self.kdf = kdf
        self.wrappedKey = wrappedKey
        self.accountId = accountId
    }
}

/// The result of `VaultStore.create`, handed back to the caller to open.
public struct CreatedVault: Sendable {
    let kdf: KdfParams
    let wrappedKey: Sealed
    let key: [UInt8]
}
