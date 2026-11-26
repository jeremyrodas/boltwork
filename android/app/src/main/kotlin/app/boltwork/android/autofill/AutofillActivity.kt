package app.boltwork.android.autofill

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.view.WindowManager
import android.view.autofill.AutofillId
import android.view.autofill.AutofillManager
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.core.content.IntentCompat
import androidx.fragment.app.FragmentActivity
import app.boltwork.android.AppModel
import app.boltwork.android.BoltworkApplication
import app.boltwork.android.BuildConfig
import app.boltwork.android.Phase
import app.boltwork.android.ui.BoltworkTheme
import app.boltwork.android.ui.ItemRow
import app.boltwork.android.ui.LockScreen
import app.boltwork.android.ui.PasswordField
import app.boltwork.core.FieldPurpose
import app.boltwork.core.Item
import app.boltwork.core.ItemCategory
import app.boltwork.core.ItemState
import app.boltwork.core.LoginMatch
import kotlinx.coroutines.launch

/** Unlocks the vault for AutoFill, lets the person pick a login, and saves logins AutoFill offered to keep. */
class AutofillActivity : FragmentActivity() {
    class PendingSave(val match: LoginMatch, val username: String, val password: String)

    private val model get() = (application as BoltworkApplication).model

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (!BuildConfig.DEBUG) window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)
        enableEdgeToEdge()
        val save = intent.getBooleanExtra(EXTRA_SAVE, false)
        val pendingSave = if (save) pendingSave.also { pendingSave = null } else null
        if (save && pendingSave == null) return finish()
        val form = if (save) null else PickForm(
            ids(EXTRA_USERNAMES), ids(EXTRA_PASSWORDS), ids(EXTRA_CODES),
            LoginMatch(intent.getStringExtra(EXTRA_DOMAIN), intent.getStringExtra(EXTRA_PACKAGE), intent.getStringExtra(EXTRA_APP_NAME)),
        )
        setContent {
            BoltworkTheme {
                when (model.phase) {
                    Phase.SignedOut -> SignedOutScreen { finish() }
                    Phase.Locked -> LockScreen(model, title = "Unlock to fill", allowSignOut = false)
                    Phase.Unlocked ->
                        if (pendingSave != null) SaveScreen(model, pendingSave, onDone = { finish() })
                        else PickerScreen(model, form!!.match, onPick = { fill(form, it) }, onCancel = { finish() })
                }
            }
        }
    }

    override fun onStart() { super.onStart(); model.cameBack() }
    override fun onStop() { super.onStop(); if (!isChangingConfigurations) model.leftApp() }

    private fun ids(key: String): List<AutofillId> = IntentCompat.getParcelableArrayListExtra(intent, key, AutofillId::class.java).orEmpty()

    private class PickForm(val usernames: List<AutofillId>, val passwords: List<AutofillId>, val codes: List<AutofillId>, val match: LoginMatch)

    private fun fill(form: PickForm, item: Item) {
        val asForm = AutofillForm(form.usernames, form.passwords, form.codes, form.match, null, null)
        val dataset = BoltworkAutofillService.dataset(this, asForm, item, BoltworkAutofillService.presentation(this, item.title, "", item.content.icon))
        model.markUsed(item.id)
        setResult(Activity.RESULT_OK, Intent().putExtra(AutofillManager.EXTRA_AUTHENTICATION_RESULT, dataset))
        finish()
    }

    companion object {
        /** Handed from the service to this screen in memory, so typed passwords never travel in an intent. */
        @Volatile var pendingSave: PendingSave? = null

        private const val EXTRA_SAVE = "save"
        private const val EXTRA_USERNAMES = "usernames"
        private const val EXTRA_PASSWORDS = "passwords"
        private const val EXTRA_CODES = "codes"
        private const val EXTRA_DOMAIN = "domain"
        private const val EXTRA_PACKAGE = "package"
        private const val EXTRA_APP_NAME = "appName"

        fun pickIntent(context: Context, form: AutofillForm) = BoltworkAutofillService.pending(
            context,
            Intent(context, AutofillActivity::class.java)
                .putParcelableArrayListExtra(EXTRA_USERNAMES, ArrayList(form.usernames))
                .putParcelableArrayListExtra(EXTRA_PASSWORDS, ArrayList(form.passwords))
                .putParcelableArrayListExtra(EXTRA_CODES, ArrayList(form.codes))
                .putExtra(EXTRA_DOMAIN, form.match.domain)
                .putExtra(EXTRA_PACKAGE, form.match.packageName)
                .putExtra(EXTRA_APP_NAME, form.match.appName),
        )

        fun saveIntent(context: Context) = BoltworkAutofillService.pending(
            context, Intent(context, AutofillActivity::class.java).putExtra(EXTRA_SAVE, true).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        )
    }
}

@Composable
private fun SignedOutScreen(onClose: () -> Unit) {
    Column(Modifier.fillMaxSize().padding(32.dp), verticalArrangement = Arrangement.spacedBy(16.dp, androidx.compose.ui.Alignment.CenterVertically)) {
        Text("Boltwork isn’t set up", style = MaterialTheme.typography.headlineSmall)
        Text("Open Boltwork and sign in or create a vault, then try again.")
        Button(onClick = onClose) { Text("Close") }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun PickerScreen(model: AppModel, match: LoginMatch, onPick: (Item) -> Unit, onCancel: () -> Unit) {
    var query by remember { mutableStateOf("") }
    val logins = model.items.filter { it.state == ItemState.active && it.category == ItemCategory.login && it.content.field(FieldPurpose.password) != null }
    val suggested = match.logins(logins, guesses = true)
    val q = query.trim().lowercase()
    val others = logins.filter { it !in suggested }
        .filter { q.isEmpty() || q in it.title.lowercase() || q in it.content.field(FieldPurpose.username)?.value.orEmpty().lowercase() || it.content.urls.any { u -> q in u.url.lowercase() } }
        .sortedBy { it.title.lowercase() }

    Scaffold(topBar = {
        TopAppBar(
            title = { Text("Fill for ${match.label}") },
            navigationIcon = { IconButton(onClick = onCancel) { Icon(Icons.Filled.Close, "Cancel") } },
        )
    }) { padding ->
        LazyColumn(Modifier.padding(padding).fillMaxSize(), contentPadding = PaddingValues(bottom = 24.dp)) {
            item {
                OutlinedTextField(
                    query, { query = it }, Modifier.fillMaxWidth().padding(16.dp, 8.dp),
                    placeholder = { Text("Search logins") }, leadingIcon = { Icon(Icons.Filled.Search, null) }, singleLine = true,
                )
            }
            if (suggested.isNotEmpty() && q.isEmpty()) {
                item { Header("Suggested") }
                items(suggested, key = { "s" + it.id }) { login -> ItemRow(login) { onPick(login) } }
            }
            if (others.isNotEmpty() || suggested.isEmpty() || q.isNotEmpty()) item { Header(if (q.isEmpty()) "All logins" else "Results") }
            items(others, key = { it.id }) { login -> ItemRow(login) { onPick(login) } }
            if (others.isEmpty() && (suggested.isEmpty() || q.isNotEmpty())) item { Text("No logins", Modifier.padding(16.dp), color = MaterialTheme.colorScheme.onSurfaceVariant) }
        }
    }
}

@Composable
private fun Header(text: String) =
    Text(text, Modifier.padding(16.dp, 12.dp, 16.dp, 4.dp), style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.primary)

@Composable
private fun SaveScreen(model: AppModel, save: AutofillActivity.PendingSave, onDone: () -> Unit) {
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    var username by remember { mutableStateOf(save.username) }
    var password by remember { mutableStateOf(save.password) }
    val existing = save.match.logins(model.items).firstOrNull { (it.content.field(FieldPurpose.username)?.value ?: "") == username.trim() }
    Column(
        Modifier.fillMaxSize().safeDrawingPadding().imePadding().verticalScroll(rememberScrollState()).padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp, androidx.compose.ui.Alignment.CenterVertically),
    ) {
        Text(if (existing != null) "Update password?" else "Save login?", style = MaterialTheme.typography.headlineSmall)
        Text(
            if (existing != null) "Boltwork will update the password on “${existing.title}”. The old one stays in its history."
            else "Boltwork will save a new login for ${save.match.label}. Check the details first.",
        )
        OutlinedTextField(username, { username = it }, Modifier.fillMaxWidth(), label = { Text("Username") }, singleLine = true)
        PasswordField(password, { password = it }, "Password", Modifier.fillMaxWidth())
        Button(onClick = {
            busy = true
            scope.launch { model.saveLogin(save.match, username.trim(), password); onDone() }
        }, enabled = !busy && password.isNotEmpty(), modifier = Modifier.fillMaxWidth()) { Text(if (existing != null) "Update" else "Save") }
        TextButton(onClick = onDone, modifier = Modifier.fillMaxWidth()) { Text("Not Now") }
    }
}
