package app.boltwork.android.ui

import android.Manifest
import android.content.ClipboardManager
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.ContentPaste
import androidx.compose.material.icons.filled.Fingerprint
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.fragment.app.FragmentActivity
import app.boltwork.android.AppModel
import app.boltwork.android.Biometrics
import app.boltwork.android.R
import app.boltwork.core.SetupCode
import kotlinx.coroutines.launch

@Composable
fun Logo() {
    Image(painterResource(R.drawable.logo), contentDescription = null, modifier = Modifier.size(84.dp).clip(RoundedCornerShape(20.dp)))
}

/** A password box with a show/hide button. */
@Composable
fun PasswordField(
    value: String, onValueChange: (String) -> Unit, label: String, modifier: Modifier = Modifier,
    imeAction: ImeAction = ImeAction.Done, onDone: () -> Unit = {}, trailing: @Composable () -> Unit = {},
) {
    var shown by remember { mutableStateOf(false) }
    OutlinedTextField(
        value, onValueChange, modifier, label = { Text(label) }, singleLine = true,
        visualTransformation = if (shown) VisualTransformation.None else PasswordVisualTransformation(),
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = imeAction, autoCorrectEnabled = false),
        keyboardActions = KeyboardActions(onDone = { onDone() }),
        trailingIcon = {
            Row {
                IconButton(onClick = { shown = !shown }) {
                    Icon(if (shown) Icons.Filled.VisibilityOff else Icons.Filled.Visibility, if (shown) "Hide" else "Show")
                }
                trailing()
            }
        },
    )
}

@Composable
fun SignInScreen(model: AppModel, onBack: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val keyboard = LocalSoftwareKeyboardController.current
    var server by rememberSaveable { mutableStateOf("") }
    var email by rememberSaveable { mutableStateOf("") }
    var secretKey by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var note by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var scanning by remember { mutableStateOf(false) }

    fun use(text: String) {
        try {
            val code = SetupCode.parse(text)
            code.server?.let { server = it }
            code.email?.let { email = it }
            secretKey = code.secretKey
            error = null
            note = "Setup code read. Now type your account password."
        } catch (e: Exception) {
            note = null
            error = e.message
        }
    }

    val askCamera = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) scanning = true else error = "Boltwork needs the camera to scan a setup code. You can allow it in this device’s settings, or paste the code instead."
    }

    if (scanning) {
        BackHandler { scanning = false }
        ScannerScreen(onCode = { scanning = false; use(it) }, onClose = { scanning = false })
        return
    }

    fun signIn() {
        if (busy) return
        keyboard?.hide()
        busy = true
        error = null
        note = null
        scope.launch {
            error = model.signIn(server, email, secretKey, password)
            busy = false
        }
    }

    Column(
        Modifier.fillMaxSize().safeDrawingPadding().imePadding().verticalScroll(rememberScrollState()).padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Row(Modifier.fillMaxWidth()) {
            IconButton(onClick = onBack, enabled = !busy) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }
        }
        Logo()
        Text("Sign in to Boltwork", style = MaterialTheme.typography.headlineSmall)
        Text(
            "Scan the setup code from Boltwork on another device, or type your details.",
            style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center,
        )
        val wide = Modifier.widthIn(max = 480.dp).fillMaxWidth()
        Row(wide, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            OutlinedButton(onClick = { askCamera.launch(Manifest.permission.CAMERA) }, modifier = Modifier.weight(1f), enabled = !busy) {
                Icon(Icons.Filled.QrCodeScanner, null, Modifier.size(18.dp))
                Text("  Scan Code")
            }
            OutlinedButton(
                onClick = {
                    val clip = context.getSystemService(ClipboardManager::class.java).primaryClip
                    use(clip?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.coerceToText(context)?.toString().orEmpty())
                },
                modifier = Modifier.weight(1f), enabled = !busy,
            ) {
                Icon(Icons.Filled.ContentPaste, null, Modifier.size(18.dp))
                Text("  Paste Code")
            }
        }
        note?.let { Text(it, wide, color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.bodyMedium) }
        OutlinedTextField(
            server, { server = it }, wide, label = { Text("Server address") }, placeholder = { Text("vault.example.com") }, singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Next, autoCorrectEnabled = false),
        )
        OutlinedTextField(
            email, { email = it }, wide, label = { Text("Email") }, singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Next, autoCorrectEnabled = false),
        )
        OutlinedTextField(
            secretKey, { secretKey = it }, wide, label = { Text("Secret Key") }, placeholder = { Text("SR1-…") }, singleLine = true,
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters, keyboardType = KeyboardType.Password, imeAction = ImeAction.Next, autoCorrectEnabled = false),
        )
        PasswordField(password, { password = it }, "Account password", wide, onDone = ::signIn)
        error?.let { Text(it, wide, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium) }
        Button(onClick = ::signIn, modifier = wide, enabled = !busy && server.isNotBlank() && email.isNotBlank() && secretKey.isNotBlank() && password.isNotEmpty()) {
            if (busy) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp) else Text("Sign In")
        }
        Text(
            "Your password and Secret Key never leave this device.",
            wide, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center,
        )
    }
}

@Composable
fun LockScreen(model: AppModel, title: String = "Boltwork is locked", allowSignOut: Boolean = true) {
    val activity = LocalContext.current as? FragmentActivity
    val scope = rememberCoroutineScope()
    val keyboard = LocalSoftwareKeyboardController.current
    var password by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var confirmSignOut by remember { mutableStateOf(false) }

    fun unlock() {
        if (busy || password.isEmpty()) return
        keyboard?.hide()
        busy = true
        error = null
        scope.launch {
            error = model.unlock(password)
            busy = false
        }
    }

    fun fingerprint() {
        val cipher = model.secrets.cipherForOpening()
        model.quickUnlockChanged()
        if (activity == null || cipher == null) {
            model.quickUnlockLost()
            error = "Biometric unlock was turned off because this device’s fingerprints or face changed. Unlock with your password to turn it back on."
            return
        }
        Biometrics.unlock(activity, "Unlock Boltwork", cipher) { unlocked ->
            if (unlocked == null) return@unlock
            scope.launch {
                busy = true
                error = runCatching { model.secrets.openQuickUnlock(unlocked) }.fold({ model.unlock(it) }, { "Biometric unlock didn’t work. Use your password." })
                busy = false
            }
        }
    }

    LaunchedEffect(Unit) { if (model.quickUnlock) fingerprint() }

    Column(
        Modifier.fillMaxSize().safeDrawingPadding().imePadding().verticalScroll(rememberScrollState()).padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Spacer(Modifier.height(48.dp))
        Logo()
        Text(title, style = MaterialTheme.typography.headlineSmall)
        model.account?.let { Text(it.email, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        val wide = Modifier.widthIn(max = 480.dp).fillMaxWidth()
        PasswordField(password, { password = it }, "Account password", wide, onDone = ::unlock)
        error?.let { Text(it, wide, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium) }
        Button(onClick = ::unlock, modifier = wide, enabled = !busy && password.isNotEmpty()) {
            if (busy) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp) else Text("Unlock")
        }
        if (model.quickUnlock) {
            OutlinedButton(onClick = ::fingerprint, modifier = wide, enabled = !busy) {
                Icon(Icons.Filled.Fingerprint, null, Modifier.size(18.dp))
                Text("  Use Biometrics")
            }
        }
        if (allowSignOut) TextButton(onClick = { confirmSignOut = true }, enabled = !busy) { Text(if (model.account != null) "Sign Out of This Device" else "Delete Vault from This Device") }
    }

    if (confirmSignOut) SignOutDialog(model.account != null, onConfirm = { confirmSignOut = false; model.signOut() }, onDismiss = { confirmSignOut = false })
}

@Composable
fun SignOutDialog(syncing: Boolean, onConfirm: () -> Unit, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (syncing) "Sign out of this device?" else "Delete this vault?") },
        text = {
            Text(
                if (syncing) "The vault is removed from this device. It stays on your sync server and your other devices. To sign in again you need your Secret Key."
                else "This vault isn’t synced anywhere, so deleting it here deletes every item in it for good. Turn on sync in Settings first if you want to keep it.",
            )
        },
        confirmButton = { TextButton(onClick = onConfirm) { Text(if (syncing) "Sign Out" else "Delete Vault", color = MaterialTheme.colorScheme.error) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}
