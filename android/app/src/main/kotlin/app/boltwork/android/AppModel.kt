package app.boltwork.android

import android.app.Application
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.os.Build
import android.os.PersistableBundle
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import app.boltwork.core.Item
import app.boltwork.core.Keyset
import app.boltwork.core.SecretKey
import app.boltwork.core.SyncClient
import app.boltwork.core.SyncEngine
import app.boltwork.core.SyncError
import app.boltwork.core.SyncServerURL
import app.boltwork.core.SyncState
import app.boltwork.core.Vault
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

    private fun opened(store: VaultStore) {
        this.store = store
        refresh()
        phase = Phase.Unlocked
        startSync()
    }

    private fun refresh() {
        val store = store ?: return
        items = store.items
        vaults = store.vaults
        account = store.syncState
    }

    fun lock() {
        if (phase != Phase.Unlocked) return
        syncLoop?.cancel()
        syncSoon?.cancel()
        store?.lock()
        store = null
        items = emptyList()
        vaults = emptyList()
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

    // Leaving and coming back

    fun leftApp() { leftAt = System.currentTimeMillis() }

    fun cameBack() {
        if (leftAt != 0L && System.currentTimeMillis() - leftAt >= autoLockMinutes * 60_000L) lock()
        leftAt = 0
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
