package app.boltwork.core

import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.io.File
import java.nio.file.Files
import java.nio.file.StandardCopyOption

/**
 * The encrypted vault on disk, compatible with the desktop app's `vault.json` (see `src/core/store.ts`).
 *
 *     <dir>/vault.json          header + wrapped master key + one sealed record per vault, collection and item
 *     <dir>/vault.json.bak      previous good copy
 *     <dir>/attachments/<id>    each attachment sealed separately
 *
 * Key derivation (Argon2id) is slow, so it lives in the companion's functions; call those off the main thread.
 * Everything else is quick. Methods are synchronized, so a sync round and an edit can't interleave mid-change.
 */
class VaultStore private constructor(
    val directory: File,
    private var kdf: KdfParams,
    private var wrappedKey: Sealed,
    private var key: ByteArray?,
    accountId: String,
    private val records: RecordSet = RecordSet(),
) {
    var accountId: String = accountId
        private set

    @get:Synchronized @set:Synchronized
    var syncState: SyncState? = null
    var historyLimit = 30

    @get:Synchronized
    var vaults: List<Vault> = emptyList()
        private set

    @get:Synchronized
    var collections: List<VaultCollection> = emptyList()
        private set

    @get:Synchronized
    var items: List<Item> = emptyList()
        private set
    var searchHistory: List<String> = emptyList()
        private set
    private var pwnedCache: Map<String, Int> = emptyMap()

    /** Records and attachments re-sealed on unlock because they were sealed with the blank key. */
    var repairedBlankKey = 0
        private set

    private val vaultFile get() = File(directory, "vault.json")
    private val attachmentsDir get() = File(directory, "attachments")

    // MARK: - Locking and saving

    val isLocked: Boolean @Synchronized get() = key == null

    /** A copy of the master key, for quick unlock to protect on this device. */
    @Synchronized
    fun masterKeyCopy(): ByteArray = requireKey().copyOf()

    /** What a sync server keeps so new devices can unlock. Safe to share. */
    val keyset: Keyset @Synchronized get() = Keyset(kdf, wrappedKey, accountId)

    @Synchronized
    fun lock() {
        key?.fill(0)
        key = null
        vaults = emptyList()
        collections = emptyList()
        items = emptyList()
        searchHistory = emptyList()
        pwnedCache = emptyMap()
    }

    private fun requireKey(): ByteArray = key ?: throw VaultError.Locked()

    @Synchronized
    fun persist() {
        records.update(requireKey(), vaults, collections, items, now())
        writeFile()
    }

    /** Writes the records atomically, keeping the previous file as `.bak`. */
    @Synchronized
    fun writeFile() {
        val key = requireKey()
        val local = VaultCrypto.sealJson(LocalData.serializer(), LocalData(pwnedCache, searchHistory), key, AAD_LOCAL)
        val file = VaultFile(VaultFile.FORMAT, VaultFile.VERSION, accountId, kdf, wrappedKey, records.all, local, syncState, now())
        directory.mkdirs()
        if (vaultFile.exists()) vaultFile.copyTo(File(directory, "vault.json.bak"), overwrite = true)
        writeAtomically(vaultFile, json.encodeToString(VaultFile.serializer(), file).toByteArray())
    }

    @Synchronized
    fun adopt(keyset: Keyset) {
        kdf = keyset.kdf
        wrappedKey = keyset.wrappedKey
        writeFile()
    }

    // MARK: - Vaults

    @Synchronized
    fun saveVault(vault: Vault): Vault {
        requireKey()
        vaults = if (vaults.any { it.id == vault.id }) vaults.map { if (it.id == vault.id) vault else it } else vaults + vault
        persist()
        return vault
    }

    // MARK: - Items

    @Synchronized
    fun item(id: String): Item {
        requireKey()
        return items.firstOrNull { it.id == id } ?: throw VaultError.NotFound("Item")
    }

    /** Creates an item (`id` null) or updates one, keeping the previous content in its history. */
    @Synchronized
    fun saveItem(id: String?, vaultId: String, content: ItemContent): Item {
        requireKey()
        if (vaults.none { it.id == vaultId }) throw VaultError.NotFound("Vault")
        val now = now()
        val clean = content.copy(
            title = content.title.trim().ifEmpty { "Untitled" },
            tags = content.tags.map { it.trim() }.filter { it.isNotEmpty() }.distinct(),
        )
        val existing = id?.let { wanted -> items.firstOrNull { it.id == wanted } }
        if (existing == null) {
            val item = Item(
                id = VaultCrypto.randomId(), vaultId = vaultId, content = clean, createdAt = now,
                passwordChangedAt = if (clean.field(FieldPurpose.password) != null) now else null,
            )
            items = items + item
            persist()
            return item
        }
        val before = existing.content
        if (before == clean && existing.vaultId == vaultId) return existing
        val passwordChanged = before.field(FieldPurpose.password)?.value != clean.field(FieldPurpose.password)?.value
        val saved = existing.copy(
            history = (listOf(ItemVersion(existing.updatedAt, before)) + existing.history).take(historyLimit),
            passwordChangedAt = if (passwordChanged) now else existing.passwordChangedAt,
            content = clean,
            vaultId = vaultId,
            updatedAt = now,
        )
        items = items.map { if (it.id == saved.id) saved else it }
        persist()
        return saved
    }

    private fun patch(id: String, touch: Boolean = true, change: (Item) -> Item): Item {
        requireKey()
        val current = items.firstOrNull { it.id == id } ?: throw VaultError.NotFound("Item")
        var changed = change(current)
        if (touch) changed = changed.copy(updatedAt = now())
        items = items.map { if (it.id == id) changed else it }
        persist()
        return changed
    }

    @Synchronized fun setFavorite(id: String, favorite: Boolean) = patch(id, touch = false) { it.copy(favorite = favorite) }
    @Synchronized fun archive(id: String) = patch(id) { it.copy(state = ItemState.archived) }
    @Synchronized fun trash(id: String) = patch(id) { it.copy(state = ItemState.deleted, deletedAt = now()) }
    @Synchronized fun restore(id: String) = patch(id) { it.copy(state = ItemState.active, deletedAt = null) }
    @Synchronized fun markUsed(id: String) = patch(id, touch = false) { it.copy(useCount = it.useCount + 1, lastUsedAt = now()) }

    @Synchronized
    fun move(id: String, toVault: String): Item {
        if (vaults.none { it.id == toVault }) throw VaultError.NotFound("Vault")
        return patch(id) { it.copy(vaultId = toVault) }
    }

    /** Permanently deletes an item and its attachments. */
    @Synchronized
    fun purge(id: String) {
        val item = item(id)
        removeAttachmentFiles(item)
        items = items.filter { it.id != id }
        persist()
    }

    /** Permanently deletes items in Recently Deleted older than `days` (0 = all of them). */
    @Synchronized
    fun emptyTrash(olderThanDays: Int = 0): Int {
        requireKey()
        val cutoff = now() - olderThanDays * 86_400_000L
        val doomed = items.filter { it.state == ItemState.deleted && (olderThanDays == 0 || (it.deletedAt ?: 0) < cutoff) }
        doomed.forEach(::removeAttachmentFiles)
        val ids = doomed.map { it.id }.toSet()
        items = items.filter { it.id !in ids }
        if (doomed.isNotEmpty()) persist()
        return doomed.size
    }

    // MARK: - Sync merge

    enum class MergeResult { Skipped, Applied, Conflict }

    /**
     * Applies a record from the sync server. If both sides changed it, the newer change wins and,
     * for items, the other version goes into the item's history.
     */
    @Synchronized
    fun mergeRemote(r: SealedRecord): MergeResult {
        val key = requireKey()
        val local = records[r.id]
        if (local != null && local.rev >= r.rev) return MergeResult.Skipped
        return when (r.kind) {
            RecordKind.vault -> merge(r, local, key, Vault.serializer(), { vaults }, { vaults = it }, { it.id }, null)
            RecordKind.collection -> merge(r, local, key, VaultCollection.serializer(), { collections }, { collections = it }, { it.id }, null)
            RecordKind.item -> merge(r, local, key, Item.serializer(), { items }, { items = it }, { it.id }, ::withHistory)
        }
    }

    private fun <T> merge(
        r: SealedRecord, local: SealedRecord?, key: ByteArray, serializer: KSerializer<T>,
        get: () -> List<T>, set: (List<T>) -> Unit, idOf: (T) -> String, combine: ((T, T) -> T)?,
    ): MergeResult {
        val data = r.data
        val remote = if (r.isDeleted || data == null) null else VaultCrypto.openJson(serializer, data, key, SealedRecord.aad(r.kind, r.id))
        val mine = get().firstOrNull { idOf(it) == r.id }
        fun replace(value: T?) {
            val list = get()
            set(
                when {
                    list.any { idOf(it) == r.id } -> if (value != null) list.map { if (idOf(it) == r.id) value else it } else list.filter { idOf(it) != r.id }
                    value != null -> list + value
                    else -> list
                }
            )
            vaults = vaults.sortedBy { it.createdAt }
        }
        if (local == null || !local.dirty) {
            replace(remote)
            records.putRemote(r, serializer, remote)
            return MergeResult.Applied
        }
        if (r.updatedAt > local.updatedAt) {
            replace(if (combine != null && remote != null && mine != null) combine(remote, mine) else remote)
            records.putRemote(r, serializer, remote)
        } else {
            if (combine != null && remote != null && mine != null) replace(combine(mine, remote))
            records.adoptRev(r.id, r.rev)
        }
        records.update(key, vaults, collections, items, now())
        return MergeResult.Conflict
    }

    private fun withHistory(winner: Item, loser: Item): Item {
        val have = winner.attachments.map { it.id }.toSet()
        var extras = winner.extras
        // Keep the other side's passkeys too: losing one would lock the user out of that site.
        val theirs = loser.extras["passkeys"] as? JsonArray
        if (theirs != null) {
            fun credentialId(e: JsonElement) = ((e as? JsonObject)?.get("credentialId") as? JsonPrimitive)?.takeIf { it.isString }?.content
            val mine = (winner.extras["passkeys"] as? JsonArray).orEmpty()
            val ids = mine.mapNotNull(::credentialId).toSet()
            val extra = theirs.filter { e -> credentialId(e)?.let { it !in ids } ?: false }
            if (extra.isNotEmpty()) extras = extras + ("passkeys" to JsonArray(mine + extra))
        }
        return winner.copy(
            history = (listOf(ItemVersion(loser.updatedAt, loser.content)) + winner.history).take(historyLimit),
            attachments = winner.attachments + loser.attachments.filter { it.id !in have },
            extras = extras,
        )
    }

    /** Records changed here since the last sync. */
    val dirtyRecords: List<SealedRecord> @Synchronized get() = records.dirty

    @Synchronized fun markSynced(id: String, rev: Int, updatedAt: Long) = records.markSynced(id, rev, updatedAt)

    internal val allRecords: List<SealedRecord> @Synchronized get() = records.all

    // MARK: - Attachments

    private fun attachmentFile(id: String) = File(attachmentsDir, id)

    @Synchronized
    fun addAttachment(itemId: String, name: String, mime: String, bytes: ByteArray): Attachment {
        val key = requireKey()
        if (bytes.size > MAX_ATTACHMENT_SIZE) throw VaultError.AttachmentTooLarge()
        val att = Attachment(VaultCrypto.randomId(), name, bytes.size.toLong(), mime, now())
        attachmentsDir.mkdirs()
        val sealed = VaultCrypto.seal(bytes, key, aadAttachment(att.id))
        writeAtomically(attachmentFile(att.id), json.encodeToString(Sealed.serializer(), sealed).toByteArray())
        patch(itemId) { it.copy(attachments = it.attachments + att) }
        return att
    }

    @Synchronized
    fun readAttachment(itemId: String, attachmentId: String): Pair<Attachment, ByteArray> {
        val key = requireKey()
        val meta = item(itemId).attachments.firstOrNull { it.id == attachmentId } ?: throw VaultError.NotFound("Attachment")
        if (!hasAttachmentFile(meta.id)) throw if (syncState != null) VaultError.AttachmentNotDownloaded() else VaultError.NotFound("Attachment file")
        val sealed = json.decodeFromString(Sealed.serializer(), attachmentFile(meta.id).readText())
        return meta to VaultCrypto.open(sealed, key, aadAttachment(meta.id))
    }

    private fun removeAttachmentFiles(item: Item) {
        for (a in item.attachments) attachmentFile(a.id).delete()
    }

    /** Ids of every attachment some item refers to. */
    val referencedAttachmentIds: Set<String> @Synchronized get() = items.flatMap { i -> i.attachments.map { it.id } }.toSet()

    fun hasAttachmentFile(id: String): Boolean = attachmentFile(id).isFile

    fun readAttachmentBlob(id: String): ByteArray = attachmentFile(id).readBytes()

    /** Stores a sealed file from the sync server after checking it opens as the attachment it claims to be. */
    @Synchronized
    fun writeAttachmentBlob(id: String, blob: ByteArray) {
        val key = requireKey()
        if (id !in referencedAttachmentIds) throw VaultError.NotFound("Attachment")
        val sealed = try {
            json.decodeFromString(Sealed.serializer(), String(blob))
        } catch (_: Exception) {
            throw VaultError.DecryptionFailed()
        }
        VaultCrypto.open(sealed, key, aadAttachment(id)).fill(0)
        attachmentsDir.mkdirs()
        writeAtomically(attachmentFile(id), blob)
    }

    /** Deletes files no item refers to any more. */
    @Synchronized
    fun removeUnreferencedAttachmentFiles(): Int {
        val keep = referencedAttachmentIds
        var removed = 0
        for (name in attachmentsDir.list().orEmpty()) {
            if (name in keep) continue
            attachmentFile(name).delete()
            if (!name.endsWith(".tmp")) removed++
        }
        return removed
    }

    private fun resealBlankAttachments(): Int {
        val key = key ?: return 0
        var n = 0
        for (id in referencedAttachmentIds) {
            if (!hasAttachmentFile(id)) continue
            try {
                val sealed = json.decodeFromString(Sealed.serializer(), attachmentFile(id).readText())
                if (runCatching { VaultCrypto.open(sealed, key, aadAttachment(id)) }.isSuccess) continue
                val bytes = VaultCrypto.open(sealed, blankKey, aadAttachment(id))
                val resealed = VaultCrypto.seal(bytes, key, aadAttachment(id))
                writeAtomically(attachmentFile(id), json.encodeToString(Sealed.serializer(), resealed).toByteArray())
                n++
            } catch (_: Exception) {
                continue
            }
        }
        return n
    }

    /** The result of `create`, handed back to the caller to open. */
    class CreatedVault internal constructor(internal val kdf: KdfParams, internal val wrappedKey: Sealed, internal val key: ByteArray)

    companion object {
        internal const val AAD_KEY = "strongroom:master-key:v1"
        internal const val AAD_DATA = "strongroom:vault-data:v1"
        internal const val AAD_LOCAL = "strongroom:local-data:v2"
        internal fun aadAttachment(id: String) = "strongroom:attachment:v1:$id"

        /** Boltwork 0.1–0.2 could seal data with an all-zero key after a quick unlock; such data is re-sealed on unlock. */
        internal val blankKey = ByteArray(32)
        const val MAX_ATTACHMENT_SIZE = 100 * 1024 * 1024

        fun now(): Long = System.currentTimeMillis()

        fun exists(directory: File): Boolean = File(directory, "vault.json").isFile

        private fun writeAtomically(file: File, bytes: ByteArray) {
            val tmp = File(file.parentFile, file.name + ".tmp")
            tmp.writeBytes(bytes)
            Files.move(tmp.toPath(), file.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
        }

        /** Makes the keys for a new vault. Slow: runs Argon2id. */
        fun create(directory: File, password: String, secretKey: String, cost: KdfCost = VaultCrypto.strongCost): CreatedVault {
            if (exists(directory)) throw VaultError.VaultExists()
            if (password.length < 8) throw VaultError.PasswordTooShort()
            val kdf = VaultCrypto.newKdfParams(cost)
            val kek = VaultCrypto.deriveKek(password, secretKey, kdf)
            try {
                val key = VaultCrypto.randomKey()
                val wrapped = VaultCrypto.sealJson(VaultCrypto.keySerializer, key.map { it.toInt() and 255 }, kek, AAD_KEY)
                return CreatedVault(kdf, wrapped, key)
            } finally {
                kek.fill(0)
            }
        }

        /** Finishes `create`: a new vault with one "Personal" vault inside. */
        fun open(created: CreatedVault, directory: File): VaultStore {
            File(directory, "attachments").mkdirs()
            val store = VaultStore(directory, created.kdf, created.wrappedKey, created.key, VaultCrypto.randomId())
            store.vaults = listOf(Vault(VaultCrypto.randomId(), "Personal", "Your private vault", "house", "#3b82f6", now()))
            store.persist()
            return store
        }

        /** Unwraps the master key with password + Secret Key. Slow: runs Argon2id. */
        fun masterKey(directory: File, password: String, secretKey: String): ByteArray {
            val file = readFile(directory)
            return unwrap(file.wrappedKey, file.kdf, password, secretKey)
        }

        /** The master key from a sync server's keyset. Slow: runs Argon2id. */
        fun masterKey(keyset: Keyset, password: String, secretKey: String): ByteArray =
            unwrap(keyset.wrappedKey, keyset.kdf, password, secretKey)

        private fun unwrap(wrappedKey: Sealed, kdf: KdfParams, password: String, secretKey: String): ByteArray {
            val kek = VaultCrypto.deriveKek(password, secretKey, kdf)
            try {
                return unwrap(wrappedKey, kek)
            } finally {
                kek.fill(0)
            }
        }

        internal fun unwrap(wrappedKey: Sealed, kek: ByteArray): ByteArray {
            try {
                val ints = VaultCrypto.openJson(VaultCrypto.keySerializer, wrappedKey, kek, AAD_KEY)
                return ByteArray(ints.size) { ints[it].toByte() }
            } catch (e: VaultError.DecryptionFailed) {
                throw VaultError.WrongPassword()
            } catch (e: kotlinx.serialization.SerializationException) {
                throw VaultError.WrongPassword()
            }
        }

        /** Derives the sync sign-in key, checking the password first. Slow: runs Argon2id. */
        fun authKey(keyset: Keyset, password: String, secretKey: String): ByteArray {
            val kek = VaultCrypto.deriveKek(password, secretKey, keyset.kdf)
            try {
                if (runCatching { VaultCrypto.open(keyset.wrappedKey, kek, AAD_KEY) }.isFailure) throw VaultError.WrongPassword()
                return VaultCrypto.authKey(kek)
            } finally {
                kek.fill(0)
            }
        }

        /** Opens the vault with its master key (from `masterKey`, or quick unlock after checking it's right). */
        fun open(directory: File, key: ByteArray): VaultStore {
            val file = readFile(directory)
            if (file.version == 1) {
                val blob = file.data ?: throw VaultError.UnsupportedFormat()
                val data = VaultCrypto.openJson(LegacyVaultData.serializer(), blob, key, AAD_DATA)
                val backup = File(directory, "vault.v1-backup.json")
                if (!backup.exists()) File(directory, "vault.json").copyTo(backup)
                val store = VaultStore(directory, file.kdf, file.wrappedKey, key.copyOf(), VaultCrypto.randomId())
                store.vaults = data.vaults
                store.items = data.items
                store.collections = data.collections.orEmpty()
                store.pwnedCache = data.pwnedCache.orEmpty()
                store.searchHistory = data.searchHistory.orEmpty()
                store.persist()
                return store
            }

            checkKey(file, key)
            val records = RecordSet()
            val opened = records.open(key, file.records.orEmpty(), fallbackKey = blankKey)
            var local = LocalData()
            var localRecovered = false
            file.local?.let { sealed ->
                runCatching { VaultCrypto.openJson(LocalData.serializer(), sealed, key, AAD_LOCAL) }
                    .onSuccess { local = it }
                    .onFailure {
                        runCatching { VaultCrypto.openJson(LocalData.serializer(), sealed, blankKey, AAD_LOCAL) }
                            .onSuccess { local = it; localRecovered = true }
                    }
            }
            val store = VaultStore(directory, file.kdf, file.wrappedKey, key.copyOf(), file.accountId ?: VaultCrypto.randomId(), records)
            store.vaults = opened.vaults.sortedBy { it.createdAt }
            store.collections = opened.collections
            store.items = opened.items
            store.pwnedCache = local.pwnedCache.orEmpty()
            store.searchHistory = local.searchHistory.orEmpty()
            store.syncState = file.sync
            if (opened.recovered.isNotEmpty() || localRecovered) {
                store.repairedBlankKey = opened.recovered.size + store.resealBlankAttachments()
                store.persist()
            }
            return store
        }

        /** Throws unless `key` is this vault's master key. */
        private fun checkKey(file: VaultFile, key: ByteArray) {
            file.local?.let { if (runCatching { VaultCrypto.open(it, key, AAD_LOCAL) }.isSuccess) return }
            val records = file.records.orEmpty()
            for (r in records) {
                val data = r.data ?: continue
                if (runCatching { VaultCrypto.open(data, key, SealedRecord.aad(r.kind, r.id)) }.isSuccess) return
            }
            if (records.none { it.data != null } && file.local == null) return
            throw VaultError.WrongPassword()
        }

        /** Sets up this device from a sync server's keyset. The first sync pulls everything. */
        fun createFromRemote(directory: File, keyset: Keyset, key: ByteArray, sync: SyncState): VaultStore {
            if (exists(directory)) throw VaultError.VaultExists()
            File(directory, "attachments").mkdirs()
            val store = VaultStore(directory, keyset.kdf, keyset.wrappedKey, key.copyOf(), keyset.accountId)
            store.syncState = sync
            store.writeFile()
            return store
        }

        internal fun readFile(directory: File): VaultFile {
            val file = try {
                json.decodeFromString(VaultFile.serializer(), File(directory, "vault.json").readText())
            } catch (_: kotlinx.serialization.SerializationException) {
                throw VaultError.UnsupportedFormat()
            } catch (_: IllegalArgumentException) {
                throw VaultError.UnsupportedFormat()
            }
            if (file.format != VaultFile.FORMAT) throw VaultError.UnsupportedFormat()
            if (file.version > VaultFile.VERSION) throw VaultError.NewerVersion()
            return file
        }

        /** The vault's account id and sync settings without unlocking it. */
        fun peekAccountId(directory: File): String? = runCatching { readFile(directory).accountId }.getOrNull()
        fun peekSyncState(directory: File): SyncState? = runCatching { readFile(directory).sync }.getOrNull()
    }
}
