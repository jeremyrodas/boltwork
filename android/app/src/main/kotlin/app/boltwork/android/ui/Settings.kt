package app.boltwork.android.ui

import app.boltwork.core.SetupCode
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.TextButton
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedTextField
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.foundation.text.KeyboardOptions
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
fun SettingsScreen(model: AppModel, onBack: () -> Unit, onSecretKey: () -> Unit, onSetupDevice: () -> Unit) {
    val activity = LocalContext.current as? FragmentActivity
    val scope = rememberCoroutineScope()
    var problem by remember { mutableStateOf<String?>(null) }
    var choosingLock by remember { mutableStateOf(false) }
    var confirmSignOut by remember { mutableStateOf(false) }
    var confirmStopSync by remember { mutableStateOf(false) }
    var confirmDeleteAccount by remember { mutableStateOf(false) }
    var changingPassword by remember { mutableStateOf(false) }

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
            val account = model.account
            if (account == null) {
                Heading("Sync")
                ConnectSyncCard(model)
            } else {
                Heading("Account")
                Card {
                    SettingRow("Email", account.email)
                    Line()
                    SettingRow("Sync server", account.serverUrl)
                }

                Heading("Sync")
                Card {
                    val status = model.syncStatus
                    val detail = when (status) {
                        SyncStatus.Syncing -> "Syncing…"
                        is SyncStatus.Failed -> status.message
                        SyncStatus.SignedOut -> "The server signed this device out. Type your account password to sign in again."
                        SyncStatus.Idle -> account.lastSyncAt?.let { "Last synced ${DateUtils.getRelativeTimeSpanString(it)}" } ?: "Not synced yet"
                    }
                    val bad = status is SyncStatus.Failed || status == SyncStatus.SignedOut
                    SettingRow(if (bad) "Sync isn’t working" else "Sync is on", detail, color = if (bad) MaterialTheme.colorScheme.error else Color.Unspecified)
                    Line()
                    if (status == SyncStatus.SignedOut) {
                        SignInAgain(model)
                    } else {
                        SettingRow("Sync Now", onClick = if (status == SyncStatus.Syncing) null else ({ scope.launch { model.syncNow() } })) {
                            if (status == SyncStatus.Syncing) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                        }
                    }
                    Line()
                    SettingRow("Set Up Another Device", "Show a code to scan on your new phone or tablet.", onClick = onSetupDevice)
                    Line()
                    SettingRow("Stop Syncing This Device…", color = MaterialTheme.colorScheme.error, onClick = { confirmStopSync = true })
                    Line()
                    SettingRow("Delete Account…", "Deletes your account and data from the server.", color = MaterialTheme.colorScheme.error, onClick = { confirmDeleteAccount = true })
                }
            }

            Heading("AutoFill")
            Card {
                val context = androidx.compose.ui.platform.LocalContext.current
                val autofill = remember { context.getSystemService(android.view.autofill.AutofillManager::class.java) }
                var autofillOn by remember { mutableStateOf(autofill?.hasEnabledAutofillServices() == true) }
                val turnOn = androidx.activity.compose.rememberLauncherForActivityResult(androidx.activity.result.contract.ActivityResultContracts.StartActivityForResult()) {
                    autofillOn = autofill?.hasEnabledAutofillServices() == true
                }
                if (autofillOn) SettingRow("AutoFill is on", "Boltwork offers your logins on sign-in screens in apps and browsers, and offers to save new ones.")
                else SettingRow("Turn On AutoFill", "Fill logins and one-time codes in other apps and browsers.", onClick = {
                    runCatching {
                        turnOn.launch(android.content.Intent(android.provider.Settings.ACTION_REQUEST_SET_AUTOFILL_SERVICE, android.net.Uri.parse("package:${context.packageName}")))
                    }
                })
                if (android.os.Build.VERSION.SDK_INT >= 34) {
                    Line()
                    SettingRow("Passkeys", "Turn on Boltwork under Passwords, passkeys and accounts to save and use passkeys in apps and browsers.", onClick = {
                        runCatching { androidx.credentials.CredentialManager.create(context).createSettingsPendingIntent().send() }
                    })
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
                SettingRow("Secret Key and Emergency Kit", onClick = onSecretKey)
                Line()
                SettingRow("Change Account Password…", onClick = { changingPassword = true })
                Line()
                SettingRow("Lock Now", onClick = { model.lock() })
            }

            Heading("This device")
            Card {
                if (model.account != null) SettingRow("Sign Out", "Removes the vault from this device only.", color = MaterialTheme.colorScheme.error, onClick = { confirmSignOut = true })
                else SettingRow("Delete Vault", "This vault is only on this device.", color = MaterialTheme.colorScheme.error, onClick = { confirmSignOut = true })
            }
            Text("Boltwork ${BuildConfig.VERSION_NAME}", Modifier.padding(16.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }

    if (changingPassword) ChangePasswordDialog(model, onDismiss = { changingPassword = false })
    if (confirmDeleteAccount) {
        var deleteError by remember { mutableStateOf<String?>(null) }
        AlertDialog(
            onDismissRequest = { confirmDeleteAccount = false },
            title = { Text("Delete your sync account?") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Everything stored on the server is deleted, and every device signed in to it stops syncing. The vault stays on this device.")
                    deleteError?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    scope.launch {
                        deleteError = model.deleteAccount()
                        if (deleteError == null) confirmDeleteAccount = false
                    }
                }) { Text("Delete Account", color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = { TextButton(onClick = { confirmDeleteAccount = false }) { Text("Cancel") } },
        )
    }
    if (confirmStopSync) {
        AlertDialog(
            onDismissRequest = { confirmStopSync = false },
            title = { Text("Stop syncing this device?") },
            text = { Text("Your vault stays on this device and on the server. Changes here won’t reach your other devices.") },
            confirmButton = { TextButton(onClick = { confirmStopSync = false; model.stopSyncing() }) { Text("Stop Syncing", color = MaterialTheme.colorScheme.error) } },
            dismissButton = { TextButton(onClick = { confirmStopSync = false }) { Text("Cancel") } },
        )
    }
    if (confirmSignOut) SignOutDialog(model.account != null, onConfirm = { confirmSignOut = false; model.signOut() }, onDismiss = { confirmSignOut = false })
}

/** Turns sync on: a new account on a server, or an existing account that holds this same vault. */
@Composable
private fun ConnectSyncCard(model: AppModel) {
    val scope = rememberCoroutineScope()
    var server by rememberSaveable { mutableStateOf("") }
    var email by rememberSaveable { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var createAccount by rememberSaveable { mutableStateOf(true) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    fun connect() {
        if (busy || server.isBlank() || email.isBlank() || password.isEmpty()) return
        busy = true
        error = null
        scope.launch {
            error = model.connectSync(server, email, password, createAccount)
            if (error == null) password = ""
            busy = false
        }
    }
    Card {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("Sync is off. This vault is only on this device.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            OutlinedTextField(
                server, { server = it }, Modifier.fillMaxWidth(), label = { Text("Server address") }, placeholder = { Text("vault.example.com") }, singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Next, autoCorrectEnabled = false),
            )
            OutlinedTextField(
                email, { email = it }, Modifier.fillMaxWidth(), label = { Text("Email") }, singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Next, autoCorrectEnabled = false),
            )
            PasswordField(password, { password = it }, "Account password", Modifier.fillMaxWidth(), onDone = ::connect)
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("Create a new account")
                    Text(
                        if (createAccount) "Makes an account on the server for this vault." else "Uses an account you already made for this vault.",
                        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Switch(createAccount, { createAccount = it })
            }
            error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium) }
            Button(onClick = ::connect, enabled = !busy && server.isNotBlank() && email.isNotBlank() && password.isNotEmpty(), modifier = Modifier.fillMaxWidth()) {
                if (busy) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp) else Text(if (createAccount) "Create Account and Sync" else "Sign In and Sync")
            }
        }
    }
}

@Composable
private fun SignInAgain(model: AppModel) {
    val scope = rememberCoroutineScope()
    var password by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    fun go() {
        if (busy || password.isEmpty()) return
        busy = true
        scope.launch {
            error = model.signInToSync(password)
            if (error == null) password = ""
            busy = false
        }
    }
    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        PasswordField(password, { password = it }, "Account password", Modifier.fillMaxWidth(), onDone = ::go)
        error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium) }
        Button(onClick = ::go, enabled = !busy && password.isNotEmpty()) { Text("Sign In Again") }
    }
}

/** The Secret Key and Emergency Kit. Asks for the account password every time it opens. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SecretKeySettingsScreen(model: AppModel, onBack: () -> Unit) {
    Scaffold(topBar = { TopAppBar(title = { Text("Secret Key") }, navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } }) }) { padding ->
        Column(Modifier.padding(padding).fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            PasswordGate(model, "Enter your account password to see your Secret Key and save a new Emergency Kit.") { secretKey ->
                Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    SecretKeyCard(secretKey)
                    Text(
                        "You need your account password and this Secret Key to open your vault on a new device. Boltwork can’t recover either one.",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    EmergencyKitButtons(secretKey, model.account?.serverUrl, model.account?.email)
                }
            }
        }
    }
}

/** A QR code another device scans to join this account. It holds the Secret Key, so it asks for the password first. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SetupDeviceScreen(model: AppModel, onBack: () -> Unit) {
    Scaffold(topBar = { TopAppBar(title = { Text("Set Up Another Device") }, navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } }) }) { padding ->
        Column(Modifier.padding(padding).fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            val account = model.account
            if (account == null) {
                Text("Turn on sync first.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                return@Column
            }
            PasswordGate(model, "Enter your account password to show a setup code for another device.") { secretKey ->
                Column(verticalArrangement = Arrangement.spacedBy(16.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    QrCode(SetupCode(account.serverUrl, account.backupUrl, account.email, secretKey).text, Modifier.widthIn(max = 300.dp))
                    Text(
                        "On your new phone or tablet, open Boltwork, choose I Already Use Boltwork, then scan this code. You’ll still type your account password there.",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text("This code contains your Secret Key. Don’t share it or take a picture of it.", color = MaterialTheme.colorScheme.error)
                }
            }
        }
    }
}

@Composable
private fun ChangePasswordDialog(model: AppModel, onDismiss: () -> Unit) {
    val context = androidx.compose.ui.platform.LocalContext.current
    val scope = rememberCoroutineScope()
    var current by remember { mutableStateOf("") }
    var new by remember { mutableStateOf("") }
    var confirm by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val ok = current.isNotEmpty() && new.length >= 8 && new == confirm && !busy
    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        title = { Text("Change Account Password") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                PasswordField(current, { current = it }, "Current password", Modifier.fillMaxWidth(), imeAction = ImeAction.Next)
                PasswordField(new, { new = it }, "New password", Modifier.fillMaxWidth(), imeAction = ImeAction.Next)
                PasswordField(confirm, { confirm = it }, "Confirm new password", Modifier.fillMaxWidth())
                if (new.isNotEmpty()) StrengthMeter(new, Modifier.fillMaxWidth())
                Text("Your Secret Key stays the same. If you sync, your other devices will ask for the new password.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            }
        },
        confirmButton = {
            TextButton(enabled = ok, onClick = {
                busy = true
                error = null
                scope.launch {
                    error = model.changePassword(current, new)
                    busy = false
                    if (error == null) {
                        android.widget.Toast.makeText(context, "Password changed", android.widget.Toast.LENGTH_SHORT).show()
                        onDismiss()
                    }
                }
            }) { if (busy) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp) else Text("Change") }
        },
        dismissButton = { TextButton(onClick = onDismiss, enabled = !busy) { Text("Cancel") } },
    )
}
