package app.boltwork.android.passkeys

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.annotation.RequiresApi
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.credentials.CreatePublicKeyCredentialRequest
import androidx.credentials.CreatePublicKeyCredentialResponse
import androidx.credentials.GetCredentialResponse
import androidx.credentials.GetPublicKeyCredentialOption
import androidx.credentials.PublicKeyCredential
import androidx.credentials.exceptions.CreateCredentialCancellationException
import androidx.credentials.exceptions.CreateCredentialUnknownException
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialUnknownException
import androidx.credentials.exceptions.domerrors.InvalidStateError
import androidx.credentials.exceptions.domerrors.NotAllowedError
import androidx.credentials.exceptions.domerrors.NotSupportedError
import androidx.credentials.exceptions.domerrors.SecurityError
import androidx.credentials.exceptions.publickeycredential.CreatePublicKeyCredentialDomException
import androidx.credentials.exceptions.publickeycredential.GetPublicKeyCredentialDomException
import androidx.credentials.provider.PendingIntentHandler
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.lifecycleScope
import app.boltwork.android.AppModel
import app.boltwork.android.Biometrics
import app.boltwork.android.BoltworkApplication
import app.boltwork.android.BuildConfig
import app.boltwork.android.Phase
import app.boltwork.android.ui.BoltworkTheme
import app.boltwork.android.ui.LockScreen
import app.boltwork.core.FieldPurpose
import app.boltwork.core.Item
import app.boltwork.core.Passkey
import app.boltwork.core.WebAuthn
import app.boltwork.core.passkeys
import kotlinx.coroutines.launch

/** Unlocks the vault for passkeys, confirms with the person, and makes or uses a passkey for an app or browser. */
@RequiresApi(34)
class PasskeyActivity : FragmentActivity() {
    private val model get() = (application as BoltworkApplication).model
    private val mode by lazy { intent.getStringExtra(EXTRA_MODE) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (!BuildConfig.DEBUG) window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)
        enableEdgeToEdge()
        // Unlocking showed it's the owner; if that wasn't just now, the passkey screen confirms again.
        val wasUnlocked = model.phase == Phase.Unlocked && System.currentTimeMillis() - model.unlockedAt > 30_000
        setContent {
            BoltworkTheme {
                when (model.phase) {
                    Phase.SignedOut -> Message("Boltwork isn’t set up", "Open Boltwork and sign in or create a vault, then try again.") { cancel() }
                    Phase.Locked -> LockScreen(model, title = if (mode == MODE_CREATE) "Unlock to save the passkey" else "Unlock to sign in", allowSignOut = false)
                    Phase.Unlocked -> when (mode) {
                        MODE_UNLOCK -> LaunchedEffect(Unit) { finishUnlock() }
                        MODE_CREATE -> CreateScreen(model, wasUnlocked)
                        else -> LaunchedEffect(Unit) { signIn(wasUnlocked) }
                    }
                }
            }
        }
    }

    override fun onStart() { super.onStart(); model.cameBack() }
    override fun onStop() { super.onStop(); if (!isChangingConfigurations) model.leftApp() }

    // MARK: Unlock, then list the passkeys

    private fun finishUnlock() {
        val request = PendingIntentHandler.retrieveBeginGetCredentialRequest(intent) ?: return cancel()
        val result = Intent()
        PendingIntentHandler.setBeginGetCredentialResponse(result, BoltworkCredentialService.entries(this, model, request))
        setResult(Activity.RESULT_OK, result)
        finish()
    }

    // MARK: Sign in

    private fun signIn(alreadyUnlocked: Boolean) {
        val request = PendingIntentHandler.retrieveProviderGetCredentialRequest(intent) ?: return cancel()
        val option = request.credentialOptions.filterIsInstance<GetPublicKeyCredentialOption>().firstOrNull() ?: return cancel()
        val item = model.item(intent.getStringExtra(EXTRA_ITEM).orEmpty())
        val passkey = item?.passkeys?.firstOrNull { it.credentialId == intent.getStringExtra(EXTRA_CREDENTIAL) }
            ?: return failGet(GetCredentialUnknownException("That passkey is no longer in Boltwork."))
        lifecycleScope.launch {
            try {
                val caller = PasskeyCaller.of(this@PasskeyActivity, request.callingAppInfo)
                val json = WebAuthn.parse(option.requestJson)
                val rpId = caller.checkRpId(WebAuthn.getRpId(json))
                if (WebAuthn.usable(listOf(passkey), json, rpId).isEmpty()) throw WebAuthn.Failure("NotAllowedError", "That passkey is for a different site.")
                val go = { ->
                    val response = WebAuthn.get(passkey, json, rpId, caller.origin, option.clientDataHash, caller.appPackage)
                    lifecycleScope.launch { model.edit { it.markPasskeyUsed(item.id, passkey.credentialId) } }
                    val result = Intent()
                    PendingIntentHandler.setGetCredentialResponse(result, GetCredentialResponse(PublicKeyCredential(response)))
                    setResult(Activity.RESULT_OK, result)
                    finish()
                }
                // Unlocking just now already showed it's the owner. Otherwise confirm first, as the passkey says the user was verified.
                if (!alreadyUnlocked) go()
                else Biometrics.confirm(this@PasskeyActivity, "Sign in with a passkey", "${passkey.userName} on $rpId") { ok -> if (ok) go() else cancel() }
            } catch (e: WebAuthn.Failure) {
                failGet(GetPublicKeyCredentialDomException(domError(e.name), e.message))
            }
        }
    }

    // MARK: Save a new passkey

    @Composable
    private fun CreateScreen(model: AppModel, alreadyUnlocked: Boolean) {
        val request = remember { PendingIntentHandler.retrieveProviderCreateCredentialRequest(intent) }
        val create = request?.callingRequest as? CreatePublicKeyCredentialRequest
        var problem by remember { mutableStateOf<String?>(null) }
        var checked by remember { mutableStateOf<Triple<PasskeyCaller, String, kotlinx.serialization.json.JsonObject>?>(null) }
        LaunchedEffect(Unit) {
            if (request == null || create == null) return@LaunchedEffect cancel()
            try {
                val caller = PasskeyCaller.of(this@PasskeyActivity, request.callingAppInfo)
                val json = WebAuthn.parse(create.requestJson)
                val rpId = caller.checkRpId(WebAuthn.createRpId(json))
                val existing = WebAuthn.excluded(json).intersect(model.passkeyIds())
                if (existing.isNotEmpty()) throw WebAuthn.Failure("InvalidStateError", "Boltwork already has a passkey for this account on $rpId.")
                checked = Triple(caller, rpId, json)
            } catch (e: WebAuthn.Failure) {
                problem = e.message
                failCreate(CreatePublicKeyCredentialDomException(domError(e.name), e.message), close = false)
            }
        }
        problem?.let { return Message("Can’t save this passkey", it) { finish() } }
        val (caller, rpId, json) = checked ?: return Busy()
        val userName = WebAuthn.createUserName(json)
        val (targets, suggested) = remember { model.passkeyTargets(rpId, userName) }
        var target by remember { mutableStateOf(suggested) }
        var busy by remember { mutableStateOf(false) }

        fun save() {
            busy = true
            val go = { ->
                lifecycleScope.launch {
                    try {
                        val (passkey, response) = WebAuthn.create(json, rpId, caller.origin, caller.appPackage)
                        model.edit { it.addPasskey(passkey, target, newLogin = target == null) } ?: throw WebAuthn.Failure("NotAllowedError", "Boltwork couldn’t save the passkey.")
                        val result = Intent()
                        PendingIntentHandler.setCreateCredentialResponse(result, CreatePublicKeyCredentialResponse(response))
                        setResult(Activity.RESULT_OK, result)
                        finish()
                    } catch (e: WebAuthn.Failure) {
                        failCreate(CreatePublicKeyCredentialDomException(domError(e.name), e.message))
                    }
                }
            }
            if (!alreadyUnlocked) go() else Biometrics.confirm(this, "Save a passkey", "$userName on $rpId") { ok -> if (ok) go() else busy = false }
        }

        Column(
            Modifier.fillMaxSize().safeDrawingPadding().imePadding().verticalScroll(rememberScrollState()).padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterVertically),
        ) {
            Text("Save a passkey?", style = MaterialTheme.typography.headlineSmall)
            Text(
                (if (caller.pageHost != null) "$rpId" else "${caller.label}, for $rpId") +
                    (if (userName.isNotEmpty()) " · $userName" else "") + ". It’s saved in your vault and works on all your Boltwork devices.",
            )
            if (targets.isNotEmpty()) {
                Text("Save it on", style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.primary)
                targets.forEach { item -> TargetRow(item.title, item.content.field(FieldPurpose.username)?.value.orEmpty(), target == item.id) { target = item.id } }
                TargetRow("A new login", userName, target == null) { target = null }
            }
            Button(onClick = ::save, enabled = !busy, modifier = Modifier.fillMaxWidth()) { Text("Save Passkey") }
            TextButton(onClick = { cancel() }, enabled = !busy, modifier = Modifier.fillMaxWidth()) { Text("Cancel") }
        }
    }

    // MARK: Results

    private fun cancel() {
        val result = Intent()
        when (mode) {
            MODE_CREATE -> PendingIntentHandler.setCreateCredentialException(result, CreateCredentialCancellationException())
            MODE_GET -> PendingIntentHandler.setGetCredentialException(result, GetCredentialCancellationException())
        }
        setResult(Activity.RESULT_OK, result)
        finish()
    }

    private fun failGet(e: androidx.credentials.exceptions.GetCredentialException) {
        val result = Intent()
        PendingIntentHandler.setGetCredentialException(result, e)
        setResult(Activity.RESULT_OK, result)
        finish()
    }

    /** Reports the failure; with [close] false the screen stays up to explain it until the person closes it. */
    private fun failCreate(e: androidx.credentials.exceptions.CreateCredentialException, close: Boolean = true) {
        val result = Intent()
        PendingIntentHandler.setCreateCredentialException(result, e)
        setResult(Activity.RESULT_OK, result)
        if (close) finish()
    }

    private fun domError(name: String) = when (name) {
        "SecurityError" -> SecurityError()
        "InvalidStateError" -> InvalidStateError()
        "NotSupportedError" -> NotSupportedError()
        else -> NotAllowedError()
    }

    companion object {
        private const val EXTRA_MODE = "mode"
        private const val EXTRA_ITEM = "item"
        private const val EXTRA_CREDENTIAL = "credential"
        private const val MODE_CREATE = "create"
        private const val MODE_GET = "get"
        private const val MODE_UNLOCK = "unlock"

        private fun base(context: Context, mode: String) = Intent(context, PasskeyActivity::class.java).putExtra(EXTRA_MODE, mode)
        fun createIntent(context: Context) = BoltworkCredentialService.pending(context, base(context, MODE_CREATE))
        fun unlockIntent(context: Context) = BoltworkCredentialService.pending(context, base(context, MODE_UNLOCK))
        fun getIntent(context: Context, itemId: String, credentialId: String) =
            BoltworkCredentialService.pending(context, base(context, MODE_GET).putExtra(EXTRA_ITEM, itemId).putExtra(EXTRA_CREDENTIAL, credentialId))
    }
}

@Composable
private fun TargetRow(title: String, detail: String, selected: Boolean, onSelect: () -> Unit) {
    Row(Modifier.fillMaxWidth().selectable(selected, onClick = onSelect).padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        RadioButton(selected, onClick = null)
        Column(Modifier.padding(start = 12.dp)) {
            Text(title)
            if (detail.isNotEmpty()) Text(detail, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun Busy() = Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) { CircularProgressIndicator() }

@Composable
private fun Message(title: String, text: String, onClose: () -> Unit) {
    Column(Modifier.fillMaxSize().padding(32.dp), verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterVertically)) {
        Text(title, style = MaterialTheme.typography.headlineSmall)
        Text(text)
        Button(onClick = onClose) { Text("Close") }
    }
}

