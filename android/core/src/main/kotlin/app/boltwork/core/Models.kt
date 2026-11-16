package app.boltwork.core

import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonEncoder
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject

/** A vault inside the account (Personal, Work, …), not the encrypted file. */
@Serializable
data class Vault(
    val id: String,
    val name: String,
    val description: String = "",
    val icon: String = "folder",
    val color: String = "#8b5cf6",
    val createdAt: Long = 0,
)

@Serializable
data class VaultCollection(val id: String, val name: String, val vaultIds: List<String> = emptyList())

@Suppress("EnumEntryName")
@Serializable
enum class ItemCategory {
    login, password, secureNote, creditCard, identity, document, bankAccount, database, driverLicense, emailAccount,
    membership, outdoorLicense, passport, rewardProgram, router, server, socialSecurityNumber, softwareLicense,
    apiCredential, cryptoWallet, medicalRecord, sshKey,
}

@Suppress("EnumEntryName")
@Serializable
enum class FieldType { text, concealed, url, email, phone, date, monthYear, totp, multiline, menu }

/** What a field means, independent of its label. */
@Suppress("EnumEntryName")
@Serializable
enum class FieldPurpose { username, password, totp, expiry, notes }

@Serializable
data class Field(
    val id: String,
    val label: String,
    val type: FieldType = FieldType.text,
    val value: String = "",
    val purpose: FieldPurpose? = null,
    val options: List<String>? = null,
)

@Serializable
data class Section(val id: String, val title: String = "", val fields: List<Field> = emptyList())

@Serializable
data class ItemUrl(val label: String = "website", val url: String, val primary: Boolean? = null)

@Serializable
data class Attachment(val id: String, val name: String, val size: Long = 0, val mime: String = "", val addedAt: Long = 0)

/** The part of an item that's kept in its history: everything the user edits. */
@Serializable
data class ItemContent(
    val category: ItemCategory,
    val title: String = "",
    val urls: List<ItemUrl> = emptyList(),
    val fields: List<Field> = emptyList(),
    val sections: List<Section> = emptyList(),
    val notes: String = "",
    val tags: List<String> = emptyList(),
    val icon: String? = null,
    val autosubmit: Boolean? = null,
) {
    /** All fields, primary first, then section fields. */
    val allFields: List<Field> get() = fields + sections.flatMap { it.fields }

    fun field(purpose: FieldPurpose): Field? = allFields.firstOrNull { it.purpose == purpose && it.value.isNotEmpty() }
}

@Serializable
data class ItemVersion(val savedAt: Long, val content: ItemContent)

@Suppress("EnumEntryName")
@Serializable
enum class ItemState { active, archived, deleted }

/** Everything on an item outside its content. */
@Serializable
internal data class ItemMeta(
    val id: String,
    val vaultId: String,
    val favorite: Boolean = false,
    val state: ItemState = ItemState.active,
    val createdAt: Long = 0,
    val updatedAt: Long? = null,
    val deletedAt: Long? = null,
    val lastUsedAt: Long? = null,
    val useCount: Int = 0,
    val passwordChangedAt: Long? = null,
    val attachments: List<Attachment> = emptyList(),
    val history: List<ItemVersion> = emptyList(),
    val watchtowerIgnore: List<String> = emptyList(),
)

/** A vault item, as stored in an encrypted record. Fields this app doesn't model (passkeys, for example) are kept in `extras`. */
@Serializable(with = ItemSerializer::class)
data class Item(
    val id: String,
    val vaultId: String,
    val content: ItemContent,
    val favorite: Boolean = false,
    val state: ItemState = ItemState.active,
    val createdAt: Long,
    val updatedAt: Long = createdAt,
    val deletedAt: Long? = null,
    val lastUsedAt: Long? = null,
    val useCount: Int = 0,
    val passwordChangedAt: Long? = null,
    val attachments: List<Attachment> = emptyList(),
    val history: List<ItemVersion> = emptyList(),
    val watchtowerIgnore: List<String> = emptyList(),
    val extras: Map<String, JsonElement> = emptyMap(),
) {
    val title: String get() = content.title
    val category: ItemCategory get() = content.category

    /** How many passkeys the item holds. */
    val passkeyCount: Int get() = (extras["passkeys"] as? JsonArray)?.size ?: 0
}

/** Reads and writes an item as one flat JSON object, keeping keys this app doesn't know. */
internal object ItemSerializer : KSerializer<Item> {
    override val descriptor: SerialDescriptor = JsonObject.serializer().descriptor

    private val ownKeys = setOf(
        "id", "vaultId", "favorite", "state", "createdAt", "updatedAt", "deletedAt", "lastUsedAt", "useCount",
        "passwordChangedAt", "attachments", "history", "watchtowerIgnore",
        "category", "title", "urls", "fields", "sections", "notes", "tags", "icon", "autosubmit",
    )

    override fun deserialize(decoder: Decoder): Item {
        val obj = (decoder as JsonDecoder).decodeJsonElement().jsonObject
        val content = json.decodeFromJsonElement(ItemContent.serializer(), obj)
        val m = json.decodeFromJsonElement(ItemMeta.serializer(), obj)
        return Item(
            m.id, m.vaultId, content, m.favorite, m.state, m.createdAt, m.updatedAt ?: m.createdAt, m.deletedAt, m.lastUsedAt,
            m.useCount, m.passwordChangedAt, m.attachments, m.history, m.watchtowerIgnore, obj.filterKeys { it !in ownKeys },
        )
    }

    override fun serialize(encoder: Encoder, value: Item) {
        val meta = ItemMeta(
            value.id, value.vaultId, value.favorite, value.state, value.createdAt, value.updatedAt, value.deletedAt, value.lastUsedAt,
            value.useCount, value.passwordChangedAt, value.attachments, value.history, value.watchtowerIgnore,
        )
        val all = json.encodeToJsonElement(ItemContent.serializer(), value.content).jsonObject +
            json.encodeToJsonElement(ItemMeta.serializer(), meta).jsonObject + value.extras
        (encoder as JsonEncoder).encodeJsonElement(JsonObject(all))
    }
}

@Suppress("EnumEntryName")
@Serializable
enum class RecordKind { vault, collection, item }

/** One encrypted vault, collection or item, as stored on disk and on the sync server. */
@Serializable
data class SealedRecord(
    val id: String,
    val kind: RecordKind,
    /** Server revision this record was last synced at; 0 if never. */
    val rev: Int = 0,
    val updatedAt: Long = 0,
    /** Changed locally since the last sync. The server leaves it out. */
    val dirty: Boolean = false,
    val deleted: Boolean? = null,
    val data: Sealed? = null,
) {
    val isDeleted: Boolean get() = deleted == true

    companion object {
        /** Internal format labels keep the app's earlier name (Strongroom). */
        fun aad(kind: RecordKind, id: String) = "strongroom:record:v2:${kind.name}:$id"
    }
}

/** Where this vault syncs to. Not secret: the server only ever sees sealed records. */
@Serializable
data class SyncState(
    val serverUrl: String,
    val email: String,
    /** Highest server revision this device has pulled. */
    val cursor: Int = 0,
    val lastSyncAt: Long? = null,
    /** Another address for the same server, used when `serverUrl` can't be reached. Set per device. */
    val backupUrl: String? = null,
) {
    /** The addresses to try, main first. */
    val addresses: List<String> get() = listOfNotNull(serverUrl, backupUrl)
}

/** `vault.json`, format version 2 (see `src/core/store.ts`). */
@Serializable
internal data class VaultFile(
    val format: String,
    val version: Int,
    val accountId: String? = null,
    val kdf: KdfParams,
    val wrappedKey: Sealed,
    val records: List<SealedRecord>? = null,
    val local: Sealed? = null,
    val sync: SyncState? = null,
    val savedAt: Long? = null,
    /** Version 1 only: everything in one sealed blob. */
    val data: Sealed? = null,
) {
    companion object {
        const val FORMAT = "strongroom-vault"
        const val VERSION = 2
    }
}

/** Device-local data sealed apart from the records. */
@Serializable
internal data class LocalData(val pwnedCache: Map<String, Int>? = null, val searchHistory: List<String>? = null)

/** The whole vault as one value (version 1 files). */
@Serializable
internal data class LegacyVaultData(
    val vaults: List<Vault>,
    val items: List<Item>,
    val collections: List<VaultCollection>? = null,
    val pwnedCache: Map<String, Int>? = null,
    val searchHistory: List<String>? = null,
)

/** The KDF parameters and wrapped master key a sync server holds for new devices. */
@Serializable
data class Keyset(val kdf: KdfParams, val wrappedKey: Sealed, val accountId: String)
