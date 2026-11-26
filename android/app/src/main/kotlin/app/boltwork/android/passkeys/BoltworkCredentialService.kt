package app.boltwork.android.passkeys

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.drawable.Icon
import android.os.Build
import android.os.CancellationSignal
import android.os.OutcomeReceiver
import androidx.annotation.RequiresApi
import androidx.credentials.exceptions.ClearCredentialException
import androidx.credentials.exceptions.CreateCredentialException
import androidx.credentials.exceptions.CreateCredentialNoCreateOptionException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.provider.AuthenticationAction
import androidx.credentials.provider.BeginCreateCredentialRequest
import androidx.credentials.provider.BeginCreateCredentialResponse
import androidx.credentials.provider.BeginCreatePublicKeyCredentialRequest
import androidx.credentials.provider.BeginGetCredentialRequest
import androidx.credentials.provider.BeginGetCredentialResponse
import androidx.credentials.provider.BeginGetPublicKeyCredentialOption
import androidx.credentials.provider.CreateEntry
import androidx.credentials.provider.CredentialProviderService
import androidx.credentials.provider.ProviderClearCredentialStateRequest
import androidx.credentials.provider.PublicKeyCredentialEntry
import app.boltwork.android.AppModel
import app.boltwork.android.BoltworkApplication
import app.boltwork.android.Phase
import app.boltwork.android.R
import app.boltwork.android.SiteIconFetcher
import app.boltwork.android.autofill.BoltworkAutofillService
import app.boltwork.core.WebAuthn
import app.boltwork.core.passkeys
import java.time.Instant

/**
 * Boltwork as a passkey provider for apps and browsers, through Android's Credential Manager. Passkeys live on login
 * items in the same format as on the other devices. The checks that matter (which site, which app) happen when the
 * person picks one, in [PasskeyActivity].
 */
@RequiresApi(34)
class BoltworkCredentialService : CredentialProviderService() {
    private val model get() = (application as BoltworkApplication).model

    override fun onBeginCreateCredentialRequest(
        request: BeginCreateCredentialRequest, cancellationSignal: CancellationSignal,
        callback: OutcomeReceiver<BeginCreateCredentialResponse, CreateCredentialException>,
    ) {
        if (request !is BeginCreatePublicKeyCredentialRequest || model.phase == Phase.SignedOut) {
            return callback.onError(CreateCredentialNoCreateOptionException())
        }
        val entry = CreateEntry.Builder(model.account?.email ?: "Boltwork", PasskeyActivity.createIntent(this))
            .setDescription("Save the passkey in Boltwork, on all your devices")
            .setIcon(Icon.createWithResource(this, R.mipmap.ic_launcher))
            .build()
        callback.onResult(BeginCreateCredentialResponse.Builder().addCreateEntry(entry).build())
    }

    override fun onBeginGetCredentialRequest(
        request: BeginGetCredentialRequest, cancellationSignal: CancellationSignal,
        callback: OutcomeReceiver<BeginGetCredentialResponse, GetCredentialException>,
    ) {
        if (model.phase == Phase.SignedOut) return callback.onResult(BeginGetCredentialResponse())
        model.lockIfIdle()
        if (model.phase == Phase.Locked) {
            val unlock = AuthenticationAction("Unlock Boltwork", PasskeyActivity.unlockIntent(this))
            return callback.onResult(BeginGetCredentialResponse.Builder().addAuthenticationAction(unlock).build())
        }
        callback.onResult(entries(this, model, request))
    }

    override fun onClearCredentialStateRequest(
        request: ProviderClearCredentialStateRequest, cancellationSignal: CancellationSignal,
        callback: OutcomeReceiver<Void?, ClearCredentialException>,
    ) = callback.onResult(null)

    companion object {
        /** The vault's passkeys for each passkey option in the request, for the person to choose from. */
        fun entries(context: Context, model: AppModel, request: BeginGetCredentialRequest): BeginGetCredentialResponse {
            val response = BeginGetCredentialResponse.Builder()
            for (option in request.beginGetCredentialOptions.filterIsInstance<BeginGetPublicKeyCredentialOption>()) {
                val json = runCatching { WebAuthn.parse(option.requestJson) }.getOrNull() ?: continue
                // Browsers fill in the page's relying party ID; it's checked against the page when the person picks one.
                val rpId = WebAuthn.getRpId(json)?.lowercase() ?: continue
                for (item in model.items.filter { it.state == app.boltwork.core.ItemState.active }) {
                    for (passkey in WebAuthn.usable(item.passkeys, json, rpId)) {
                        val entry = PublicKeyCredentialEntry.Builder(context, passkey.userName.ifEmpty { item.title }, PasskeyActivity.getIntent(context, item.id, passkey.credentialId), option)
                            .setDisplayName(passkey.userDisplayName ?: item.title)
                            .setIcon(item.content.icon?.let(SiteIconFetcher::decode)?.let(Icon::createWithBitmap) ?: Icon.createWithResource(context, R.mipmap.ic_launcher))
                            .apply { (passkey.lastUsedAt ?: item.lastUsedAt)?.let { setLastUsedTime(Instant.ofEpochMilli(it)) } }
                            .build()
                        response.addCredentialEntry(entry)
                    }
                }
            }
            return response.build()
        }

        fun pending(context: Context, intent: Intent): PendingIntent = BoltworkAutofillService.pending(context, intent)

    }
}
