package app.boltwork.core

data class SyncResult(var pulled: Int = 0, var pushed: Int = 0, var conflicts: Int = 0, var filesUp: Int = 0, var filesDown: Int = 0)

/** Thrown when sync was turned off while a round was running. */
class SyncCancelled : Exception("Sync was turned off.")

/** Keeps a `VaultStore` in step with a sync server (see `syncOnce` in `src/core/sync.ts`). Blocking. */
object SyncEngine {
    /** Files on the server no item refers to are only removed after this long, in case another device just uploaded one. */
    private const val ORPHAN_GRACE_MS = 6 * 3_600_000L

    /** Signs in on a new device: fetches KDF parameters, derives the auth key locally, and signs in. */
    fun signIn(client: SyncClient, email: String, password: String, secretKey: String, device: String): SyncClient.LoginResponse {
        val kdf = client.prelogin(email)
        val kek = VaultCrypto.deriveKek(password, secretKey, kdf)
        val auth = try { VaultCrypto.authKey(kek) } finally { kek.fill(0) }
        return client.login(email, auth, device)
    }

    /** `signIn`, plus the master key from the same (slow) key derivation, for setting up a new device. */
    fun signInAndUnlock(client: SyncClient, email: String, password: String, secretKey: String, device: String): Pair<SyncClient.LoginResponse, ByteArray> {
        val kek = VaultCrypto.deriveKek(password, secretKey, client.prelogin(email))
        try {
            val reply = client.login(email, VaultCrypto.authKey(kek), device)
            return reply to VaultStore.unwrap(reply.wrappedKey, kek)
        } finally {
            kek.fill(0)
        }
    }

    /** One round: pull everything newer than the cursor, push local changes, then sync attachment files. */
    fun syncOnce(store: VaultStore, client: SyncClient): SyncResult {
        var cursor = store.syncState?.cursor ?: throw SyncError(0, "Sync is not set up.")
        val result = SyncResult()

        // Progress goes onto the vault's sync state as it is now: it can be turned off while this round waits on the server.
        fun record(change: (SyncState) -> SyncState) {
            synchronized(store) { store.syncState = change(store.syncState ?: throw SyncCancelled()) }
        }

        while (true) {
            val page = client.pull(cursor)
            if (store.syncState == null) throw SyncCancelled()
            for (r in page.records) {
                val how = store.mergeRemote(r)
                if (how != VaultStore.MergeResult.Skipped) result.pulled++
                if (how == VaultStore.MergeResult.Conflict) result.conflicts++
            }
            cursor = page.cursor
            record { it.copy(cursor = cursor) }
            if (!page.more) break
        }

        for (round in 0 until 5) {
            val dirty = store.dirtyRecords
            if (dirty.isEmpty()) break
            for (batch in dirty.chunked(500)) {
                val res = client.push(batch)
                if (store.syncState == null) throw SyncCancelled()
                val sent = batch.associate { it.id to it.updatedAt }
                for (a in res.accepted) {
                    store.markSynced(a.id, a.rev, sent[a.id] ?: 0)
                    result.pushed++
                }
                for (c in res.conflicts) if (store.mergeRemote(c) == VaultStore.MergeResult.Conflict) result.conflicts++
            }
        }
        store.writeFile()

        syncFiles(store, client, result)

        record { it.copy(lastSyncAt = VaultStore.now()) }
        store.writeFile()
        return result
    }

    private fun syncFiles(store: VaultStore, client: SyncClient, result: SyncResult) {
        val wanted = store.referencedAttachmentIds
        val listing = client.listBlobs()
        val onServer = listing.blobs.map { it.id }.toSet()
        for (id in wanted) {
            if (store.hasAttachmentFile(id)) {
                if (id !in onServer) {
                    client.putBlob(id, store.readAttachmentBlob(id))
                    result.filesUp++
                }
            } else if (id in onServer) {
                val blob = client.getBlob(id) ?: continue
                // Damaged or tampered files are left missing and tried again next time.
                if (runCatching { store.writeAttachmentBlob(id, blob) }.isSuccess) result.filesDown++
            }
        }
        for (b in listing.blobs) {
            if (b.id !in wanted && listing.now - b.createdAt >= ORPHAN_GRACE_MS) client.deleteBlob(b.id)
        }
        store.removeUnreferencedAttachmentFiles()
    }
}
