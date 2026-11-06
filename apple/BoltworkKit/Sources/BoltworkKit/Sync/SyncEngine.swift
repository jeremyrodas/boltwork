import Foundation

public struct SyncResult: Sendable {
    public var pulled = 0, pushed = 0, conflicts = 0, filesUp = 0, filesDown = 0
}

/// Keeps a `VaultStore` in step with a sync server (see `syncOnce` in `src/core/sync.ts`).
@MainActor
public enum SyncEngine {
    /// Files on the server no item refers to are only removed after this long, in case another device just uploaded one.
    static let orphanGraceMs: Int64 = 6 * 3_600_000

    /// Signs in on a new device: fetches KDF parameters, derives the auth key locally, and signs in.
    public static func signIn(client: inout SyncClient, email: String, password: String, secretKey: String, device: String) async throws -> SyncClient.LoginResponse {
        let kdf = try await client.prelogin(email: email)
        let auth = try await deriveAuthKey(password: password, secretKey: secretKey, kdf: kdf)
        return try await client.login(email: email, authKey: auth, device: device)
    }

    @concurrent
    private static func deriveAuthKey(password: String, secretKey: String, kdf: KdfParams) async throws -> [UInt8] {
        var kek = try VaultCrypto.deriveKek(password: password, secretKey: secretKey, kdf: kdf)
        defer { VaultCrypto.wipe(&kek) }
        return VaultCrypto.authKey(fromKek: kek)
    }

    /// One round: pull everything newer than the cursor, push local changes, then sync attachment files.
    @discardableResult
    public static func syncOnce(store: VaultStore, client: SyncClient) async throws -> SyncResult {
        guard var state = store.syncState else { throw SyncError(status: 0, message: "Sync is not set up.") }
        var result = SyncResult()

        while true {
            let page = try await client.pull(since: state.cursor)
            for r in page.records {
                let how = try store.mergeRemote(r)
                if how != .skipped { result.pulled += 1 }
                if how == .conflict { result.conflicts += 1 }
            }
            state.cursor = page.cursor
            store.syncState = state
            if !page.more { break }
        }

        for _ in 0..<5 {
            let dirty = store.dirtyRecords
            if dirty.isEmpty { break }
            for start in stride(from: 0, to: dirty.count, by: 500) {
                let batch = Array(dirty[start..<min(start + 500, dirty.count)])
                let res = try await client.push(batch)
                let sent = Dictionary(uniqueKeysWithValues: batch.map { ($0.id, $0.updatedAt) })
                for a in res.accepted {
                    store.markSynced(id: a.id, rev: a.rev, updatedAt: sent[a.id] ?? 0)
                    result.pushed += 1
                }
                for c in res.conflicts where try store.mergeRemote(c) == .conflict { result.conflicts += 1 }
            }
        }
        try store.writeFile()

        try await syncFiles(store: store, client: client, result: &result)

        state.lastSyncAt = VaultStore.now()
        store.syncState = state
        try store.writeFile()
        return result
    }

    private static func syncFiles(store: VaultStore, client: SyncClient, result: inout SyncResult) async throws {
        let wanted = store.referencedAttachmentIds
        let listing = try await client.listBlobs()
        let onServer = Set(listing.blobs.map(\.id))
        for id in wanted {
            if store.hasAttachmentFile(id) {
                if !onServer.contains(id) {
                    try await client.putBlob(id, store.readAttachmentBlob(id))
                    result.filesUp += 1
                }
            } else if onServer.contains(id), let blob = try await client.getBlob(id) {
                // Damaged or tampered files are left missing and tried again next time.
                if (try? store.writeAttachmentBlob(id, blob)) != nil { result.filesDown += 1 }
            }
        }
        for b in listing.blobs where !wanted.contains(b.id) && listing.now - b.createdAt >= orphanGraceMs {
            try await client.deleteBlob(b.id)
        }
        store.removeUnreferencedAttachmentFiles()
    }
}
