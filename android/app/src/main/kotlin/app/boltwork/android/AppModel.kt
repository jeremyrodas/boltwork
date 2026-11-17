package app.boltwork.android

import android.app.Application
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.net.Uri
import android.os.Build
import android.provider.OpenableColumns
import androidx.core.content.FileProvider
import android.os.PersistableBundle
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import app.boltwork.core.ItemUrl
import app.boltwork.core.ItemCategory
import app.boltwork.core.ItemTemplate
import app.boltwork.core.LoginMatch
import app.boltwork.core.FieldPurpose
import app.boltwork.core.Item
import app.boltwork.core.ItemState
import app.boltwork.core.Watchtower
import app.boltwork.core.Keyset
import app.boltwork.core.SecretKey
import app.boltwork.core.SyncClient
import app.boltwork.core.SyncEngine
import app.boltwork.core.SyncError
import app.boltwork.core.SyncServerURL
import app.boltwork.core.SyncState
import app.boltwork.core.Vault
import app.boltwork.core.VaultError
import app.boltwork.core.VaultStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.io.File

enum class Phase { SignedOut, Locked, Unlocked }

sealed interface SyncStatus {
    data object Idle : SyncStatus
    data object Syncing : SyncStatus
    data class Failed(val message: String) : SyncStatus
    /** The server no longer accepts this device; the user has to sign in again. */
    data object SignedOut : SyncStatus
}

/** The app's state: the vault on this device, whether it's unlocked, and keeping it in step with the server. */
class AppModel(private val app: Application) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val settings = app.getSharedPreferences("settings", Context.MODE_PRIVATE)
    private val directory = File(app.filesDir, "vault")
    val secrets = DeviceSecrets(app)

    var phase by mutableStateOf(if (VaultStore.exists(directory)) Phase.Locked else Phase.SignedOut)
        private set
    var items by mutableStateOf(emptyList<Item>())
        private set
    var vaults by mutableStateOf(emptyList<Vault>())
        private set
    var account by mutableStateOf(VaultStore.peekSyncState(directory))
        private set
    var syncStatus by mutableStateOf<SyncStatus>(SyncStatus.Idle)
        private set
    var quickUnlock by mutableStateOf(secrets.hasQuickUnlock)
        private set
    var autoLockMinutes by mutableStateOf(settings.getInt("autoLockMinutes", 5))
        private set
    var pwnedCounts by mutableStateOf(emptyMap<String, Int>())
        private set
    var checkBreaches by mutableStateOf(settings.getBoolean("checkBreaches", false))
        private set

    private var store: VaultStore? = null
    private var syncLoop: Job? = null
    private var syncSoon: Job? = null
    private val syncing = Mutex()
    private var leftAt = 0L

    private fun message(e: Throwable) = e.message ?: "Something went wrong."

    // Signing in and unlocking

    /** Sets this device up from the sync server. Returns what went wrong, or null. */
    suspend fun signIn(server: String, email: String, secretKey: String, password: String): String? = try {
        val store = withContext(Dispatchers.IO) {
            val url = SyncServerURL.normalize(server)
            val key = SecretKey.normalize(secretKey)
            val client = SyncClient(url)
            val mail = email.trim().lowercase()
            val (reply, masterKey) = SyncEngine.signInAndUnlock(client, mail, password, key, Build.MODEL ?: "Android")
            directory.deleteRecursively()
            val store = VaultStore.createFromRemote(directory, Keyset(reply.kdf, reply.wrappedKey, reply.accountId), masterKey, SyncState(url, mail))
            masterKey.fill(0)
            secrets[DeviceSecrets.SECRET_KEY] = key
            secrets[DeviceSecrets.TOKEN] = client.token
            store
        }
        opened(store)
        null
    } catch (e: Exception) {
        message(e)
    }

    /** A new Secret Key to show once, after creating a vault. */
    var newSecretKey by mutableStateOf<String?>(null)

    /** Makes a new vault on this device only, with a new Secret Key. Sync can be turned on later in Settings. */
    suspend fun createVault(password: String): String? = try {
        val (store, key) = withContext(Dispatchers.IO) {
            val key = SecretKey.generate()
            directory.deleteRecursively()
            val created = VaultStore.create(directory, password, key)
            val store = VaultStore.open(created, directory)
            secrets[DeviceSecrets.SECRET_KEY] = key
            store to key
        }
        newSecretKey = key
        opened(store)
        null
    } catch (e: Exception) {
        message(e)
    }

    suspend fun unlock(password: String): String? = try {
        val secretKey = secrets[DeviceSecrets.SECRET_KEY] ?: throw IllegalStateException("This device lost its Secret Key. Sign out and sign in again.")
        opened(withContext(Dispatchers.IO) { VaultStore.open(directory, VaultStore.masterKey(directory, password, secretKey)) })
        null
    } catch (e: Exception) {
        message(e)
    }

    /** Unlocks with the master key fingerprint unlock kept. */
    suspend fun unlock(masterKey: ByteArray): String? = try {
        opened(withContext(Dispatchers.IO) { VaultStore.open(directory, masterKey) })
        null
    } catch (e: Exception) {
        message(e)
    } finally {
        masterKey.fill(0)
    }

    /** When the vault was last unlocked, so a passkey right after unlocking doesn't ask again. */
    var unlockedAt = 0L
        private set

    private fun opened(store: VaultStore) {
        this.store = store
        unlockedAt = System.currentTimeMillis()
        refresh()
        phase = Phase.Unlocked
        startSync()
    }

    private fun refresh() {
        val store = store ?: return
        items = store.items
        vaults = store.vaults
        account = store.syncState
        pwnedCounts = store.pwnedCounts
    }

    fun lock() {
        if (phase != Phase.Unlocked) return
        openedFiles.deleteRecursively()
        File(app.cacheDir, "kit").deleteRecursively()
        syncLoop?.cancel()
        syncSoon?.cancel()
        store?.lock()
        store = null
        items = emptyList()
        vaults = emptyList()
        pwnedCounts = emptyMap()
        phase = Phase.Locked
    }

    /** Removes the vault from this device. It stays on the server and the user's other devices. */
    fun signOut() {
        val state = account
        val token = secrets[DeviceSecrets.TOKEN]
        lock()
        if (state != null && !token.isNullOrEmpty()) {
            scope.launch(Dispatchers.IO) { runCatching { SyncClient.reachable(state.addresses, token).logout() } }
        }
        directory.deleteRecursively()
        secrets.clear()
        quickUnlock = false
        account = null
        syncStatus = SyncStatus.Idle
        phase = Phase.SignedOut
    }

    // Turning sync on and off

    /** Connects this vault to a sync server, making a new account there or using the existing one. Returns what went wrong, or null. */
    suspend fun connectSync(server: String, email: String, password: String, createAccount: Boolean): String? = try {
        val store = store ?: throw IllegalStateException("Boltwork is locked.")
        val secretKey = secrets[DeviceSecrets.SECRET_KEY] ?: throw IllegalStateException("This device lost its Secret Key.")
        withContext(Dispatchers.IO) {
            val url = SyncServerURL.normalize(server)
            val mail = email.trim().lowercase()
            if (mail.isEmpty() || !mail.contains("@")) throw IllegalArgumentException("Enter your email address.")
            val auth = VaultStore.authKey(store.keyset, password, secretKey)
            val client = SyncClient(url)
            if (createAccount) {
                client.signup(mail, auth, store.keyset, Build.MODEL ?: "Android")
            } else {
                val login = client.login(mail, auth, Build.MODEL ?: "Android")
                if (login.accountId != store.keyset.accountId) {
                    runCatching { client.logout() }
                    throw SyncError(0, "That account on the server holds a different vault. To use it on this device, delete this vault and sign in to that account instead.")
                }
            }
            store.syncState = SyncState(url, mail)
            store.writeFile()
            secrets[DeviceSecrets.TOKEN] = client.token
        }
        account = store.syncState
        syncStatus = SyncStatus.Idle
        startSync()
        null
    } catch (e: Exception) {
        message(e)
    }

    /** Signs back in after the server ended this device's session. */
    suspend fun signInToSync(password: String): String? = try {
        val store = store ?: throw IllegalStateException("Boltwork is locked.")
        val state = store.syncState ?: throw IllegalStateException("Sync is off.")
        val secretKey = secrets[DeviceSecrets.SECRET_KEY] ?: throw IllegalStateException("This device lost its Secret Key.")
        withContext(Dispatchers.IO) {
            val auth = VaultStore.authKey(store.keyset, password, secretKey)
            val client = SyncClient.reachable(state.addresses, "")
            client.login(state.email, auth, Build.MODEL ?: "Android")
            secrets[DeviceSecrets.TOKEN] = client.token
        }
        syncStatus = SyncStatus.Idle
        startSync()
        null
    } catch (e: Exception) {
        message(e)
    }

    /** Disconnects this device from the server. The vault stays here and on the server. */
    fun stopSyncing() {
        val store = store ?: return
        val state = store.syncState ?: return
        val token = secrets[DeviceSecrets.TOKEN]
        syncLoop?.cancel()
        syncSoon?.cancel()
        if (!token.isNullOrEmpty()) scope.launch(Dispatchers.IO) { runCatching { SyncClient.reachable(state.addresses, token).logout() } }
        store.syncState = null
        runCatching { store.writeFile() }
        secrets.remove(DeviceSecrets.TOKEN)
        account = null
        syncStatus = SyncStatus.Idle
    }

    /** Changes the account password. Updates the server first, so if that fails the old password still works everywhere. */
    suspend fun changePassword(current: String, new: String): String? = try {
        val store = store ?: throw IllegalStateException("Boltwork is locked.")
        val secretKey = secrets[DeviceSecrets.SECRET_KEY] ?: throw IllegalStateException("This device lost its Secret Key.")
        withContext(Dispatchers.IO) {
            val master = store.masterKeyCopy()
            val (keyset, auth) = try { VaultStore.rewrap(store.keyset, master, current, new, secretKey) } finally { master.fill(0) }
            val state = store.syncState
            val token = secrets[DeviceSecrets.TOKEN]
            if (state != null && !token.isNullOrEmpty()) SyncClient.reachable(state.addresses, token).updateKeys(auth, keyset)
            store.adopt(keyset)
        }
        null
    } catch (e: Exception) {
        message(e)
    }

    /** Deletes the sync account and everything on the server. The vault stays on this device, with sync off. */
    suspend fun deleteAccount(): String? = try {
        val store = store ?: throw IllegalStateException("Boltwork is locked.")
        val state = store.syncState ?: throw IllegalStateException("Sync is off.")
        withContext(Dispatchers.IO) { SyncClient.reachable(state.addresses, secrets[DeviceSecrets.TOKEN] ?: "").deleteAccount() }
        syncLoop?.cancel()
        syncSoon?.cancel()
        store.syncState = null
        withContext(Dispatchers.IO) { store.writeFile() }
        secrets.remove(DeviceSecrets.TOKEN)
        account = null
        syncStatus = SyncStatus.Idle
        null
    } catch (e: Exception) {
        message(e)
    }

    /** The Secret Key, after checking the account password. Null if the password is wrong. */
    suspend fun revealSecretKey(password: String): String? {
        val store = store ?: return null
        val secretKey = secrets[DeviceSecrets.SECRET_KEY] ?: return null
        return withContext(Dispatchers.IO) {
            runCatching {
                val derived = VaultStore.masterKey(store.keyset, password, secretKey)
                val current = store.masterKeyCopy()
                val same = derived.contentEquals(current)
                derived.fill(0); current.fill(0)
                if (same) secretKey else null
            }.getOrNull()
        }
    }

    // Leaving and coming back

    fun leftApp() { leftAt = System.currentTimeMillis() }

    fun cameBack() {
        if (leftAt != 0L && System.currentTimeMillis() - leftAt >= autoLockMinutes * 60_000L) lock()
        leftAt = 0
    }

    /** For AutoFill while the app is in the background: locks if the auto-lock time has passed. */
    fun lockIfIdle() {
        if (phase == Phase.Unlocked && leftAt != 0L && System.currentTimeMillis() - leftAt >= autoLockMinutes * 60_000L) lock()
    }

    fun setAutoLock(minutes: Int) {
        autoLockMinutes = minutes
        settings.edit().putInt("autoLockMinutes", minutes).apply()
    }

    // Fingerprint unlock

    fun masterKeyCopy(): ByteArray? = runCatching { store?.masterKeyCopy() }.getOrNull()

    fun quickUnlockChanged() { quickUnlock = secrets.hasQuickUnlock }

    // Editing

    fun item(id: String): Item? = items.firstOrNull { it.id == id }

    /** Counts a copy or fill, for Recently Used. */
    fun markUsed(id: String) {
        scope.launch { edit { it.markUsed(id) } }
    }

    /** Every passkey credential ID in the vault. */
    fun passkeyIds(): Set<String> = store?.passkeyIds ?: emptySet()

    /** Logins a new passkey for this site could go on, and the default one (null: a new login). */
    fun passkeyTargets(rpId: String, userName: String): Pair<List<Item>, String?> = store?.passkeyTargets(rpId, userName) ?: (emptyList<Item>() to null)

    /** Saves a login AutoFill offered to keep: updates the matching login with this username, or adds a new one. */
    suspend fun saveLogin(match: LoginMatch, username: String, password: String): Item? = edit { store ->
        val existing = match.logins(store.items).firstOrNull { (it.content.field(FieldPurpose.username)?.value ?: "") == username }
        if (existing != null) {
            store.saveItem(existing.id, existing.vaultId, existing.content.copy(fields = existing.content.fields.map { if (it.purpose == FieldPurpose.password) it.copy(value = password) else it }))
        } else {
            val blank = ItemTemplate.blankContent(ItemCategory.login)
            val content = blank.copy(
                title = match.label,
                urls = listOfNotNull(match.saveAddress?.let { ItemUrl(url = it) }),
                fields = blank.fields.map {
                    when (it.purpose) {
                        FieldPurpose.username -> it.copy(value = username)
                        FieldPurpose.password -> it.copy(value = password)
                        else -> it
                    }
                },
            )
            store.saveItem(null, store.vaults.first().id, content)
        }
    }

    // Attachments

    private val openedFiles get() = File(app.cacheDir, "attachments")

    /** Adds a file the user picked. Returns what went wrong, or null. */
    suspend fun addAttachment(itemId: String, uri: Uri): String? = try {
        withContext(Dispatchers.IO) {
            val resolver = app.contentResolver
            val name = resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
                if (c.moveToFirst()) c.getString(0) else null
            } ?: uri.lastPathSegment ?: "File"
            val mime = resolver.getType(uri) ?: "application/octet-stream"
            val bytes = resolver.openInputStream(uri)?.use { input ->
                val out = java.io.ByteArrayOutputStream()
                val buffer = ByteArray(64 * 1024)
                while (true) {
                    val n = input.read(buffer)
                    if (n < 0) break
                    out.write(buffer, 0, n)
                    if (out.size() > VaultStore.MAX_ATTACHMENT_SIZE) throw VaultError.AttachmentTooLarge()
                }
                out.toByteArray()
            } ?: throw java.io.IOException("That file couldn’t be read.")
            (store ?: throw IllegalStateException("Boltwork is locked.")).addAttachment(itemId, name, mime, bytes)
        }
        edit { }
        null
    } catch (e: Exception) {
        message(e)
    }

    /** Decrypts an attachment into the cache for another app to show, and returns a link to it. Removed on lock. */
    suspend fun openAttachment(itemId: String, attachmentId: String): Result<Pair<Uri, String>> = runCatching {
        val store = store ?: throw IllegalStateException("Boltwork is locked.")
        withContext(Dispatchers.IO) {
            val (meta, bytes) = store.readAttachment(itemId, attachmentId)
            val folder = File(openedFiles, meta.id).apply { deleteRecursively(); mkdirs() }
            val safeName = meta.name.replace(Regex("[/\\\\:*?\"<>|]"), "_").ifBlank { "file" }
            val file = File(folder, safeName)
            file.writeBytes(bytes)
            bytes.fill(0)
            FileProvider.getUriForFile(app, "app.boltwork.android.files", file) to meta.mime.ifBlank { "application/octet-stream" }
        }
    }

    // Watchtower

    fun changeCheckBreaches(on: Boolean) {
        checkBreaches = on
        settings.edit().putBoolean("checkBreaches", on).apply()
    }

    /** Looks up passwords not checked yet, sending only the first 5 characters of each SHA-1. Stops at the first failure, such as being offline. */
    suspend fun lookUpBreaches() {
        val store = store ?: return
        val known = store.pwnedCounts
        val hashes = items.filter { it.state == ItemState.active }
            .mapNotNull { it.content.field(FieldPurpose.password)?.value }.map(Watchtower::sha1Hex).toSet() - known.keys
        if (hashes.isEmpty()) return
        val found = withContext(Dispatchers.IO) {
            val found = HashMap<String, Int>()
            for (hash in hashes) found[hash] = runCatching { Watchtower.pwnedCount(hash) }.getOrNull() ?: break
            runCatching { store.recordPwned(found) }
            found
        }
        if (this.store === store && found.isNotEmpty()) pwnedCounts = store.pwnedCounts
    }

    /** Runs a change on the vault off the main thread, then shows the result and syncs it. Returns null if it failed. */
    suspend fun <T> edit(change: (VaultStore) -> T): T? {
        val store = store ?: return null
        val result = try {
            withContext(Dispatchers.IO) { change(store) }
        } catch (_: Exception) {
            null
        }
        refresh()
        syncSoon?.cancel()
        syncSoon = scope.launch {
            delay(1500)
            syncNow()
        }
        return result
    }

    // Sync

    private fun startSync() {
        syncLoop?.cancel()
        val store = store ?: return
        if (store.syncState == null) return
        syncLoop = scope.launch {
            var due = true
            while (isActive) {
                if (due || store.dirtyRecords.isNotEmpty()) {
                    if (!syncNow()) {
                        if (syncStatus == SyncStatus.SignedOut) return@launch
                        delay(30_000)
                        continue
                    }
                }
                val changes = withContext(Dispatchers.IO) {
                    runCatching { client(store)?.waitForChanges(store.syncState?.cursor ?: 0) }.getOrNull()
                }
                if (changes == null) delay(30_000)
                due = changes?.changed != false
            }
        }
    }

    private fun client(store: VaultStore): SyncClient? {
        val state = store.syncState ?: return null
        return SyncClient.reachable(state.addresses, secrets[DeviceSecrets.TOKEN] ?: "")
    }

    /** One sync round. Returns whether it worked. */
    suspend fun syncNow(): Boolean = syncing.withLock {
        val store = store ?: return false
        if (store.syncState == null) return true
        syncStatus = SyncStatus.Syncing
        try {
            withContext(Dispatchers.IO) { SyncEngine.syncOnce(store, client(store) ?: throw SyncError(0, "Sync is not set up.")) }
            if (this.store === store) refresh()
            syncStatus = SyncStatus.Idle
            true
        } catch (e: Exception) {
            syncStatus = if (e is SyncError && e.isSignedOut) SyncStatus.SignedOut else SyncStatus.Failed(message(e))
            false
        }
    }

    // Clipboard

    private var clearClipboard: Job? = null

    /** Copies `text`, marked as sensitive so the system doesn't preview it, and clears it after 90 seconds. */
    fun copy(text: String) {
        val clipboard = app.getSystemService(ClipboardManager::class.java)
        val clip = ClipData.newPlainText("Boltwork", text)
        clip.description.extras = PersistableBundle().apply { putBoolean("android.content.extra.IS_SENSITIVE", true) }
        clipboard.setPrimaryClip(clip)
        clearClipboard?.cancel()
        var ours = true
        val listener = ClipboardManager.OnPrimaryClipChangedListener { ours = false }
        clearClipboard = scope.launch {
            delay(100)
            clipboard.addPrimaryClipChangedListener(listener)
            try {
                delay(90_000)
                if (ours) clipboard.clearPrimaryClip()
            } finally {
                clipboard.removePrimaryClipChangedListener(listener)
            }
        }
    }
}
