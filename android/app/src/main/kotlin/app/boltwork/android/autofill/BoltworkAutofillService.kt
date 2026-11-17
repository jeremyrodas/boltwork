package app.boltwork.android.autofill

import android.app.ActivityOptions
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.CancellationSignal
import android.service.autofill.AutofillService
import android.service.autofill.Dataset
import android.service.autofill.FillCallback
import android.service.autofill.FillRequest
import android.service.autofill.FillResponse
import android.service.autofill.SaveCallback
import android.service.autofill.SaveInfo
import android.service.autofill.SaveRequest
import android.view.autofill.AutofillId
import android.view.autofill.AutofillValue
import android.widget.RemoteViews
import app.boltwork.android.BoltworkApplication
import app.boltwork.android.Phase
import app.boltwork.android.R
import app.boltwork.core.FieldPurpose
import app.boltwork.core.Item
import app.boltwork.core.Totp
import java.util.concurrent.atomic.AtomicInteger

/**
 * Offers logins from the vault on other apps' and websites' sign-in screens, and offers to save new ones.
 * Logins only fill where their website or app matches; anything else goes through the picker, where the person chooses.
 */
class BoltworkAutofillService : AutofillService() {
    private val model get() = (application as BoltworkApplication).model

    override fun onFillRequest(request: FillRequest, cancellationSignal: CancellationSignal, callback: FillCallback) {
        val form = request.fillContexts.lastOrNull()?.structure?.let { AutofillForm.parse(it, ::appName) }
        if (form == null || model.phase == Phase.SignedOut) return callback.onSuccess(null)
        model.lockIfIdle()

        val response = FillResponse.Builder()
        var count = 0
        if (model.phase == Phase.Unlocked) {
            for (item in form.match.logins(model.items).take(5)) {
                val username = item.content.field(FieldPurpose.username)?.value.orEmpty()
                response.addDataset(dataset(this, form, item, presentation(this, item.title, username.ifEmpty { "Login" })))
                count++
            }
        }
        val pickerTitle = if (model.phase == Phase.Unlocked) "Choose from Boltwork…" else "Unlock Boltwork"
        val picker = Dataset.Builder(presentation(this, pickerTitle, form.match.label))
        form.allIds.forEach { picker.setValue(it, null) }
        picker.setAuthentication(AutofillActivity.pickIntent(this, form).intentSender)
        response.addDataset(picker.build())

        if (form.passwords.isNotEmpty()) {
            response.setSaveInfo(
                SaveInfo.Builder(SaveInfo.SAVE_DATA_TYPE_PASSWORD or (if (form.usernames.isNotEmpty()) SaveInfo.SAVE_DATA_TYPE_USERNAME else 0), form.passwords.toTypedArray())
                    .apply { if (form.usernames.isNotEmpty()) setOptionalIds(form.usernames.toTypedArray()) }
                    .build(),
            )
        }
        callback.onSuccess(response.build())
    }

    override fun onSaveRequest(request: SaveRequest, callback: SaveCallback) {
        val form = request.fillContexts.lastOrNull()?.structure?.let { AutofillForm.parse(it, ::appName) }
        val password = form?.typedPassword
        if (form == null || password.isNullOrEmpty()) return callback.onSuccess()
        AutofillActivity.pendingSave = AutofillActivity.PendingSave(form.match, form.typedUsername.orEmpty(), password)
        callback.onSuccess(AutofillActivity.saveIntent(this).intentSender)
    }

    private fun appName(pkg: String): String? =
        runCatching { packageManager.getApplicationLabel(packageManager.getApplicationInfo(pkg, 0)).toString() }.getOrNull()

    companion object {
        private val requestCodes = AtomicInteger(1)
        fun nextRequestCode() = requestCodes.incrementAndGet()

        fun presentation(context: Context, title: String, subtitle: String) = RemoteViews(context.packageName, R.layout.autofill_item).apply {
            setTextViewText(R.id.autofill_title, title)
            setTextViewText(R.id.autofill_subtitle, subtitle)
        }

        /** The values for one login, filled into this form. */
        fun dataset(context: Context, form: AutofillForm, item: Item, presentation: RemoteViews): Dataset {
            val builder = Dataset.Builder(presentation)
            val username = item.content.field(FieldPurpose.username)?.value.orEmpty()
            val password = item.content.field(FieldPurpose.password)?.value.orEmpty()
            val code = item.content.field(FieldPurpose.totp)?.value?.takeIf { it.isNotBlank() }
                ?.let { runCatching { Totp(it).code(System.currentTimeMillis()) }.getOrNull() }
            fun set(ids: List<AutofillId>, value: String) = ids.forEach { builder.setValue(it, AutofillValue.forText(value)) }
            set(form.usernames, username)
            set(form.passwords, password)
            if (code != null) set(form.codes, code)
            // A dataset needs one value; a code-only screen with no code still offers the login's username.
            if (form.usernames.isEmpty() && form.passwords.isEmpty() && code == null) set(form.codes, "")
            return builder.build()
        }

        /** Lets the system open Boltwork's screen when the person taps, even though Boltwork isn't in the foreground. */
        @Suppress("DEPRECATION")
        fun pending(context: Context, intent: Intent): PendingIntent {
            val options = when {
                Build.VERSION.SDK_INT >= 36 -> ActivityOptions.makeBasic().setPendingIntentCreatorBackgroundActivityStartMode(ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOW_ALWAYS).toBundle()
                Build.VERSION.SDK_INT >= 34 -> ActivityOptions.makeBasic().setPendingIntentCreatorBackgroundActivityStartMode(ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED).toBundle()
                else -> null
            }
            return PendingIntent.getActivity(context, nextRequestCode(), intent, PendingIntent.FLAG_CANCEL_CURRENT or PendingIntent.FLAG_MUTABLE, options)
        }
    }
}
