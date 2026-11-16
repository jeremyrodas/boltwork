package app.boltwork.android.ui

import android.text.format.DateUtils
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.fragment.app.FragmentActivity
import app.boltwork.android.AppModel
import app.boltwork.android.Biometrics
import app.boltwork.android.BuildConfig
import app.boltwork.android.SyncStatus
import kotlinx.coroutines.launch

@Composable
private fun SettingRow(title: String, detail: String? = null, color: Color = Color.Unspecified, onClick: (() -> Unit)? = null, trailing: @Composable () -> Unit = {}) {
    Row(
        Modifier.fillMaxWidth().then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier).padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyLarge, color = color)
            if (detail != null) Text(detail, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        trailing()
    }
}

@Composable
private fun Heading(text: String) {
    Text(text, Modifier.padding(start = 16.dp, top = 12.dp), style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.primary)
}

@Composable
private fun Line() = HorizontalDivider(Modifier.padding(start = 16.dp), color = MaterialTheme.colorScheme.outlineVariant)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(model: AppModel, onBack: () -> Unit) {
    val activity = LocalContext.current as? FragmentActivity
    val scope = rememberCoroutineScope()
    var problem by remember { mutableStateOf<String?>(null) }
    var choosingLock by remember { mutableStateOf(false) }
    var confirmSignOut by remember { mutableStateOf(false) }

    fun setFingerprint(on: Boolean) {
        problem = null
        if (!on) {
            model.secrets.removeQuickUnlock()
            model.quickUnlockChanged()
            return
        }
        val noFingerprint = "Set up a fingerprint or face unlock in this device’s settings first."
        if (activity == null || !Biometrics.available(activity)) {
            problem = noFingerprint
            return
        }
        val cipher = runCatching { model.secrets.cipherForSaving() }.getOrNull()
        if (cipher == null) {
            problem = noFingerprint
            return
        }
        Biometrics.unlock(activity, "Turn on fingerprint unlock", cipher) { unlocked ->
            val key = model.masterKeyCopy()
            if (unlocked != null && key != null) {
                runCatching { model.secrets.saveQuickUnlock(unlocked, key) }.onFailure { problem = "Fingerprint unlock couldn’t be turned on." }
            }
            key?.fill(0)
            model.quickUnlockChanged()
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(title = { Text("Settings") }, navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } })
        },
    ) { padding ->
        Column(Modifier.padding(padding).fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Heading("Account")
            Card {
                SettingRow("Email", model.account?.email)
                Line()
                SettingRow("Sync server", model.account?.serverUrl)
            }

            Heading("Sync")
            Card {
                val status = model.syncStatus
                val detail = when (status) {
                    SyncStatus.Syncing -> "Syncing…"
                    is SyncStatus.Failed -> status.message
                    SyncStatus.SignedOut -> "The server signed this device out. Sign out here, then sign in again."
                    SyncStatus.Idle -> model.account?.lastSyncAt?.let { "Last synced ${DateUtils.getRelativeTimeSpanString(it)}" } ?: "Not synced yet"
                }
                val bad = status is SyncStatus.Failed || status == SyncStatus.SignedOut
                SettingRow(if (bad) "Sync isn’t working" else "Sync is on", detail, color = if (bad) MaterialTheme.colorScheme.error else Color.Unspecified)
                Line()
                SettingRow("Sync Now", onClick = if (status == SyncStatus.Syncing) null else ({ scope.launch { model.syncNow() } })) {
                    if (status == SyncStatus.Syncing) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                }
            }

            Heading("Security")
            Card {
                SettingRow("Unlock with fingerprint", "Your account password still works, and is needed after the device’s fingerprints change.") {
                    Switch(model.quickUnlock, ::setFingerprint)
                }
                problem?.let { Text(it, Modifier.padding(horizontal = 16.dp).padding(bottom = 12.dp), color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium) }
                Line()
                val choices = listOf(0 to "Right away", 1 to "After 1 minute", 5 to "After 5 minutes", 15 to "After 15 minutes", 60 to "After 1 hour")
                SettingRow("Lock when I leave the app", choices.firstOrNull { it.first == model.autoLockMinutes }?.second ?: "After ${model.autoLockMinutes} minutes", onClick = { choosingLock = true }) {
                    DropdownMenu(choosingLock, { choosingLock = false }) {
                        for ((minutes, name) in choices) DropdownMenuItem({ Text(name) }, { choosingLock = false; model.setAutoLock(minutes) })
                    }
                }
                Line()
                SettingRow("Lock Now", onClick = { model.lock() })
            }

            Heading("This device")
            Card {
                SettingRow("Sign Out", "Removes the vault from this device only.", color = MaterialTheme.colorScheme.error, onClick = { confirmSignOut = true })
            }
            Text("Boltwork ${BuildConfig.VERSION_NAME}", Modifier.padding(16.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }

    if (confirmSignOut) SignOutDialog(onConfirm = { confirmSignOut = false; model.signOut() }, onDismiss = { confirmSignOut = false })
}
