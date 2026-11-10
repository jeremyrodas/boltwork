import CryptoKit
import Foundation

/// The sealed form of every record, re-sealing only what changed (see `src/core/records.ts`).
struct RecordSet {
    private(set) var records: [String: SealedRecord] = [:]
    /// Order records were first seen in, so the file keeps a stable order.
    private var order: [String] = []
    private var hashes: [String: String] = [:]

    var all: [SealedRecord] { order.compactMap { records[$0] } }
    var dirty: [SealedRecord] { all.filter(\.dirty) }
    subscript(id: String) -> SealedRecord? { records[id] }

    static func hash<T: Encodable>(_ value: T) -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        let data = (try? encoder.encode(value)) ?? Data()
        return Data(SHA256.hash(data: data)).base64EncodedString()
    }

    private mutating func put(_ r: SealedRecord) {
        if records[r.id] == nil { order.append(r.id) }
        records[r.id] = r
    }

    /// Loads records and remembers what they decrypt to. Records that only open with `fallbackKey` are
    /// returned in `recovered` and left without a hash, so the next `update` re-seals them with `key`.
    static func open(key: [UInt8], sealed: [SealedRecord], fallbackKey: [UInt8]? = nil) throws
        -> (set: RecordSet, vaults: [Vault], collections: [VaultCollection], items: [Item], recovered: [String]) {
        var set = RecordSet()
        var vaults: [Vault] = [], collections: [VaultCollection] = [], items: [Item] = [], recovered: [String] = []
        for r in sealed {
            set.put(r)
            guard !r.isDeleted, let data = r.data else { continue }
            var plaintext: [UInt8]
            do {
                plaintext = try VaultCrypto.open(data, key: key, aad: SealedRecord.aad(r.kind, r.id))
            } catch {
                guard let fallbackKey else { throw error }
                plaintext = try VaultCrypto.open(data, key: fallbackKey, aad: SealedRecord.aad(r.kind, r.id))
                recovered.append(r.id)
            }
            let decoder = JSONCoding.decoder
            switch r.kind {
            case .vault:
                let v = try decoder.decode(Vault.self, from: Data(plaintext))
                vaults.append(v)
                if !recovered.contains(r.id) { set.hashes[r.id] = hash(v) }
            case .collection:
                let c = try decoder.decode(VaultCollection.self, from: Data(plaintext))
                collections.append(c)
                if !recovered.contains(r.id) { set.hashes[r.id] = hash(c) }
            case .item:
                let i = try decoder.decode(Item.self, from: Data(plaintext))
                items.append(i)
                if !recovered.contains(r.id) { set.hashes[r.id] = hash(i) }
            }
            VaultCrypto.wipe(&plaintext)
        }
        return (set, vaults, collections, items, recovered)
    }

    /// Seals new or changed records and tombstones removed ones.
    mutating func update(key: [UInt8], vaults: [Vault], collections: [VaultCollection], items: [Item], now: Int64) throws {
        var seen = Set<String>()
        func sync<T: Encodable>(_ id: String, _ kind: RecordKind, _ value: T) throws {
            seen.insert(id)
            let h = Self.hash(value)
            let existing = records[id]
            if let existing, !existing.isDeleted, hashes[id] == h { return }
            let sealed = try VaultCrypto.sealJSON(value, key: key, aad: SealedRecord.aad(kind, id))
            put(SealedRecord(id: id, kind: kind, rev: existing?.rev ?? 0, updatedAt: now, dirty: true, data: sealed))
            hashes[id] = h
        }
        for v in vaults { try sync(v.id, .vault, v) }
        for c in collections { try sync(c.id, .collection, c) }
        for i in items { try sync(i.id, .item, i) }
        for r in all where !seen.contains(r.id) && !r.isDeleted {
            put(SealedRecord(id: r.id, kind: r.kind, rev: r.rev, updatedAt: now, dirty: true, deleted: true))
            hashes[r.id] = nil
        }
    }

    /// After the server accepted a record at `rev`. Stays dirty if the record changed again meanwhile.
    mutating func markSynced(id: String, rev: Int, updatedAt: Int64) {
        guard var r = records[id] else { return }
        r.rev = rev
        if r.updatedAt == updatedAt { r.dirty = false }
        records[id] = r
    }

    /// After sync is turned off: nothing has been sent anywhere, so a later setup uploads everything again.
    mutating func forgetServerRevisions() {
        for id in order { records[id]?.rev = 0; records[id]?.dirty = true }
    }

    /// Keeps local changes but bases them on the server's newer revision.
    mutating func adoptRev(id: String, rev: Int) {
        records[id]?.rev = rev
    }

    /// Stores a record exactly as it came from the server.
    mutating func putRemote<T: Encodable>(_ r: SealedRecord, plaintext: T?) {
        var copy = r
        copy.dirty = false
        put(copy)
        hashes[r.id] = plaintext.map { Self.hash($0) }
    }
}
