package app.boltwork.core

import kotlinx.serialization.KSerializer
import java.security.MessageDigest

/** The sealed form of every record, re-sealing only what changed (see `src/core/records.ts`). */
internal class RecordSet {
    /** In the order records were first seen, so the file keeps a stable order. */
    private val records = LinkedHashMap<String, SealedRecord>()
    private val hashes = HashMap<String, String>()

    val all: List<SealedRecord> get() = records.values.toList()
    val dirty: List<SealedRecord> get() = records.values.filter { it.dirty }
    operator fun get(id: String): SealedRecord? = records[id]

    class Opened(val vaults: List<Vault>, val collections: List<VaultCollection>, val items: List<Item>, val recovered: List<String>)

    /**
     * Loads records and remembers what they decrypt to. Records that only open with `fallbackKey` are
     * returned in `recovered` and left without a hash, so the next `update` re-seals them with `key`.
     */
    fun open(key: ByteArray, sealed: List<SealedRecord>, fallbackKey: ByteArray? = null): Opened {
        val vaults = ArrayList<Vault>()
        val collections = ArrayList<VaultCollection>()
        val items = ArrayList<Item>()
        val recovered = ArrayList<String>()
        for (r in sealed) {
            records[r.id] = r
            val data = r.data
            if (r.isDeleted || data == null) continue
            val aad = SealedRecord.aad(r.kind, r.id)
            var wasRecovered = false
            val plain = try {
                VaultCrypto.open(data, key, aad)
            } catch (e: VaultError) {
                if (fallbackKey == null) throw e
                wasRecovered = true
                VaultCrypto.open(data, fallbackKey, aad)
            }
            val text = String(plain)
            plain.fill(0)
            if (wasRecovered) recovered.add(r.id)
            fun <T> read(serializer: KSerializer<T>): T = json.decodeFromString(serializer, text).also {
                if (!wasRecovered) hashes[r.id] = hash(serializer, it)
            }
            when (r.kind) {
                RecordKind.vault -> vaults.add(read(Vault.serializer()))
                RecordKind.collection -> collections.add(read(VaultCollection.serializer()))
                RecordKind.item -> items.add(read(Item.serializer()))
            }
        }
        return Opened(vaults, collections, items, recovered)
    }

    /** Seals new or changed records and tombstones removed ones. */
    fun update(key: ByteArray, vaults: List<Vault>, collections: List<VaultCollection>, items: List<Item>, now: Long) {
        val seen = HashSet<String>()
        fun <T> sync(id: String, kind: RecordKind, serializer: KSerializer<T>, value: T) {
            seen.add(id)
            val h = hash(serializer, value)
            val existing = records[id]
            if (existing != null && !existing.isDeleted && hashes[id] == h) return
            val sealed = VaultCrypto.sealJson(serializer, value, key, SealedRecord.aad(kind, id))
            records[id] = SealedRecord(id, kind, existing?.rev ?: 0, now, dirty = true, data = sealed)
            hashes[id] = h
        }
        for (v in vaults) sync(v.id, RecordKind.vault, Vault.serializer(), v)
        for (c in collections) sync(c.id, RecordKind.collection, VaultCollection.serializer(), c)
        for (i in items) sync(i.id, RecordKind.item, Item.serializer(), i)
        for (r in all) {
            if (r.id in seen || r.isDeleted) continue
            records[r.id] = SealedRecord(r.id, r.kind, r.rev, now, dirty = true, deleted = true)
            hashes.remove(r.id)
        }
    }

    /** After the server accepted a record at `rev`. Stays dirty if the record changed again meanwhile. */
    fun markSynced(id: String, rev: Int, updatedAt: Long) {
        val r = records[id] ?: return
        records[id] = r.copy(rev = rev, dirty = if (r.updatedAt == updatedAt) false else r.dirty)
    }

    /** After sync is turned off: nothing has been sent anywhere, so a later setup uploads everything again. */
    fun forgetServerRevisions() {
        for ((id, r) in records) records[id] = r.copy(rev = 0, dirty = true)
    }

    /** Keeps local changes but bases them on the server's newer revision. */
    fun adoptRev(id: String, rev: Int) {
        records[id]?.let { records[id] = it.copy(rev = rev) }
    }

    /** Stores a record exactly as it came from the server. */
    fun <T> putRemote(r: SealedRecord, serializer: KSerializer<T>, plaintext: T?) {
        records[r.id] = r.copy(dirty = false)
        if (plaintext == null) hashes.remove(r.id) else hashes[r.id] = hash(serializer, plaintext)
    }

    companion object {
        fun <T> hash(serializer: KSerializer<T>, value: T): String =
            MessageDigest.getInstance("SHA-256").digest(json.encodeToString(serializer, value).toByteArray()).base64()
    }
}
