package app.boltwork.android.ui

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Typeface
import android.graphics.pdf.PdfDocument
import android.os.Bundle
import android.os.CancellationSignal
import android.os.ParcelFileDescriptor
import android.print.PageRange
import android.print.PrintAttributes
import android.print.PrintDocumentAdapter
import android.print.PrintDocumentInfo
import android.print.PrintManager
import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
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
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.verticalScroll
import androidx.compose.ui.semantics.Role
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Print
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import app.boltwork.android.AppModel
import app.boltwork.android.R
import app.boltwork.core.PasswordStrength
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileOutputStream
import java.text.DateFormat
import java.util.Date

/** First launch: make a new vault, or sign in to an account from another device. */
@Composable
fun WelcomeScreen(model: AppModel) {
    var route by rememberSaveable { mutableStateOf("") }
    when (route) {
        "create" -> { BackHandler { route = "" }; CreateVaultScreen(model, onBack = { route = "" }) }
        "join" -> { BackHandler { route = "" }; SignInScreen(model, onBack = { route = "" }) }
        else -> Column(
            Modifier.fillMaxSize().safeDrawingPadding().verticalScroll(rememberScrollState()).padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Spacer(Modifier.height(64.dp))
            Image(painterResourceLogo(), null, Modifier.size(112.dp))
            Text("Welcome to Boltwork", style = MaterialTheme.typography.headlineMedium)
            Text(
                "A password manager that keeps your vault on your own devices, sealed with your password and a Secret Key.",
                textAlign = TextAlign.Center, color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(48.dp))
            val wide = Modifier.widthIn(max = 480.dp).fillMaxWidth()
            Button(onClick = { route = "create" }, modifier = wide) { Text("Create a New Vault") }
            OutlinedButton(onClick = { route = "join" }, modifier = wide) { Text("I Already Use Boltwork") }
            Text(
                "Using Boltwork on another device? Sign in with your sync server to bring your vault here.",
                wide, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center,
            )
        }
    }
}

@Composable
private fun painterResourceLogo() = androidx.compose.ui.res.painterResource(R.drawable.logo)

/** A bar and a word for how strong a password is. */
@Composable
fun StrengthMeter(password: String, modifier: Modifier = Modifier) {
    val strength = remember(password) { PasswordStrength(password) }
    val color = when {
        strength.level <= 2 -> Color(0xFFD64545); strength.level <= 4 -> Color(0xFFE0A800); else -> Color(0xFF2E9E5B)
    }
    Column(modifier, verticalArrangement = Arrangement.spacedBy(4.dp)) {
        LinearProgressIndicator(progress = { strength.level / 7f }, modifier = Modifier.fillMaxWidth(), color = color, drawStopIndicator = {})
        Text(strength.label, style = MaterialTheme.typography.labelMedium, color = color)
    }
}

/** Choosing an account password for a new vault. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun CreateVaultScreen(model: AppModel, onBack: () -> Unit) {
    val scope = rememberCoroutineScope()
    val keyboard = LocalSoftwareKeyboardController.current
    var password by remember { mutableStateOf("") }
    var confirmation by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val canCreate = password.length >= 8 && password == confirmation && !busy

    fun create() {
        if (!canCreate) return
        keyboard?.hide()
        busy = true
        error = null
        scope.launch {
            error = model.createVault(password)
            busy = false
        }
    }

    Scaffold(topBar = { TopAppBar(title = { Text("New Vault") }, navigationIcon = { IconButton(onClick = onBack, enabled = !busy) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } }) }) { padding ->
        Column(
            Modifier.padding(padding).fillMaxSize().imePadding().verticalScroll(rememberScrollState()).padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            PasswordField(password, { password = it }, "Account password", Modifier.fillMaxWidth(), imeAction = ImeAction.Next)
            PasswordField(confirmation, { confirmation = it }, "Confirm password", Modifier.fillMaxWidth(), onDone = ::create)
            if (password.isNotEmpty()) StrengthMeter(password, Modifier.fillMaxWidth())
            if (confirmation.isNotEmpty() && confirmation != password) Text("The passwords don’t match.", color = MaterialTheme.colorScheme.error)
            Text(
                "Use at least 8 characters. You’ll type it to unlock Boltwork, so make it memorable. Nobody can reset it for you.",
                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            Button(onClick = ::create, enabled = canCreate, modifier = Modifier.fillMaxWidth()) {
                if (busy) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp) else Text("Create Vault")
            }
        }
    }
}

/** Shows a new account's Secret Key once, so the user can save it. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NewSecretKeyScreen(secretKey: String, onDone: () -> Unit) {
    var saved by remember { mutableStateOf(false) }
    BackHandler(enabled = !saved) {}
    Scaffold(topBar = { TopAppBar(title = { Text("Your Secret Key") }) }) { padding ->
        Column(Modifier.padding(padding).fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            SecretKeyCard(secretKey)
            Text(
                "You need your account password and this Secret Key to open your vault on a new device. Boltwork can’t recover either one. " +
                    "Save the Emergency Kit somewhere safe, like a password-protected drive or a printout.",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            EmergencyKitButtons(secretKey, server = null, email = null)
            Row(Modifier.toggleable(saved, role = Role.Switch) { saved = it }.padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("I saved my Secret Key", Modifier.weight(1f))
                Switch(saved, null)
            }
            Button(onClick = onDone, enabled = saved, modifier = Modifier.fillMaxWidth()) { Text("Done") }
        }
    }
}

@Composable
fun SecretKeyCard(secretKey: String) {
    Box(Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surfaceContainer, RoundedCornerShape(16.dp)).padding(20.dp)) {
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text("Secret Key", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
            Text(secretKey, style = MaterialTheme.typography.titleMedium, fontFamily = FontFamily.Monospace)
        }
    }
}

/** Saves the Emergency Kit as a PDF where the user chooses, or prints it. */
@Composable
fun EmergencyKitButtons(secretKey: String, server: String?, email: String?) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val save = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/pdf")) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            val ok = withContext(Dispatchers.IO) {
                runCatching {
                    val file = EmergencyKit.render(context, secretKey, server, email)
                    context.contentResolver.openOutputStream(uri)?.use { out -> file.inputStream().use { it.copyTo(out) } }
                    file.delete()
                }.isSuccess
            }
            Toast.makeText(context, if (ok) "Emergency Kit saved" else "The Emergency Kit couldn’t be saved.", Toast.LENGTH_SHORT).show()
        }
    }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedButton(onClick = { save.launch("Boltwork Emergency Kit.pdf") }, modifier = Modifier.fillMaxWidth()) {
            Icon(Icons.Filled.Download, null, Modifier.size(18.dp)); Text("  Save Emergency Kit")
        }
        OutlinedButton(onClick = {
            scope.launch {
                val file = withContext(Dispatchers.IO) { runCatching { EmergencyKit.render(context, secretKey, server, email) }.getOrNull() }
                if (file == null) Toast.makeText(context, "The Emergency Kit couldn’t be made.", Toast.LENGTH_SHORT).show()
                else EmergencyKit.print(context, file)
            }
        }, modifier = Modifier.fillMaxWidth()) {
            Icon(Icons.Filled.Print, null, Modifier.size(18.dp)); Text("  Print Emergency Kit")
        }
    }
}

/** The printed Emergency Kit: Secret Key, sync details and a blank for the password, as one US Letter page. */
object EmergencyKit {
    private fun folder(context: Context) = File(context.cacheDir, "kit")

    /** Removes kits left from earlier, such as after printing. */
    fun clear(context: Context) { folder(context).deleteRecursively() }

    fun render(context: Context, secretKey: String, server: String?, email: String?): File {
        val doc = PdfDocument()
        val page = doc.startPage(PdfDocument.PageInfo.Builder(612, 792, 1).create())
        val c = page.canvas
        val ink = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = android.graphics.Color.rgb(31, 36, 48) }
        val muted = Paint(ink).apply { color = android.graphics.Color.rgb(90, 94, 105) }
        val line = Paint(ink).apply { color = android.graphics.Color.rgb(200, 196, 186); strokeWidth = 1f }
        var y = 48f
        BitmapFactory.decodeResource(context.resources, R.drawable.logo)?.let { logo ->
            c.drawBitmap(logo, null, RectF(48f, y, 96f, y + 48f), Paint(Paint.FILTER_BITMAP_FLAG))
        }
        c.drawText("Boltwork Emergency Kit", 108f, y + 34f, Paint(ink).apply { textSize = 28f; typeface = Typeface.DEFAULT_BOLD })
        y += 88f
        val body = Paint(ink).apply { textSize = 13f }
        for (text in listOf("Keep this page somewhere safe. With it and your account password you can open your", "vault on a new device.")) {
            c.drawText(text, 48f, y, body); y += 18f
        }
        y += 16f
        fun field(label: String, value: String, mono: Boolean = false) {
            c.drawText(label.uppercase(), 48f, y, Paint(muted).apply { textSize = 10f; typeface = Typeface.DEFAULT_BOLD; letterSpacing = 0.08f })
            y += 22f
            c.drawText(value, 48f, y, Paint(ink).apply { textSize = if (mono) 18f else 15f; typeface = if (mono) Typeface.MONOSPACE else Typeface.DEFAULT })
            y += 12f
            c.drawLine(48f, y, 564f, y, line)
            y += 28f
        }
        field("Secret Key", secretKey, mono = true)
        server?.let { field("Sync server", it) }
        email?.let { field("Email", it) }
        field("Account password", " ")
        c.drawText("Created ${DateFormat.getDateInstance(DateFormat.LONG).format(Date())}", 48f, y, Paint(muted).apply { textSize = 10f })
        doc.finishPage(page)
        val file = File(folder(context).apply { mkdirs() }, "Boltwork Emergency Kit.pdf")
        FileOutputStream(file).use { doc.writeTo(it) }
        doc.close()
        return file
    }

    fun print(context: Context, file: File) {
        val manager = context.getSystemService(PrintManager::class.java) ?: return
        manager.print("Boltwork Emergency Kit", object : PrintDocumentAdapter() {
            override fun onLayout(old: PrintAttributes?, new: PrintAttributes?, cancel: CancellationSignal?, callback: LayoutResultCallback, extras: Bundle?) {
                if (cancel?.isCanceled == true) return callback.onLayoutCancelled()
                callback.onLayoutFinished(PrintDocumentInfo.Builder(file.name).setContentType(PrintDocumentInfo.CONTENT_TYPE_DOCUMENT).setPageCount(1).build(), true)
            }
            override fun onWrite(pages: Array<out PageRange>?, destination: ParcelFileDescriptor, cancel: CancellationSignal?, callback: WriteResultCallback) {
                runCatching {
                    file.inputStream().use { input -> FileOutputStream(destination.fileDescriptor).use { input.copyTo(it) } }
                }.onSuccess { callback.onWriteFinished(arrayOf(PageRange.ALL_PAGES)) }.onFailure { callback.onWriteFailed(it.message) }
            }
            override fun onFinish() { file.delete() }
        }, null)
    }
}

/** A QR code on a white card, so it scans in dark mode too. */
@Composable
fun QrCode(text: String, modifier: Modifier = Modifier) {
    val bitmap = remember(text) {
        val hints = mapOf(EncodeHintType.ERROR_CORRECTION to ErrorCorrectionLevel.M, EncodeHintType.MARGIN to 0)
        val matrix = QRCodeWriter().encode(text, BarcodeFormat.QR_CODE, 0, 0, hints)
        Bitmap.createBitmap(matrix.width, matrix.height, Bitmap.Config.ARGB_8888).apply {
            for (x in 0 until matrix.width) for (y in 0 until matrix.height) setPixel(x, y, if (matrix[x, y]) android.graphics.Color.BLACK else android.graphics.Color.WHITE)
        }.asImageBitmap()
    }
    Box(modifier.background(Color.White, RoundedCornerShape(12.dp)).padding(16.dp)) {
        Image(bitmap, "Setup code", Modifier.fillMaxWidth(), filterQuality = FilterQuality.None)
    }
}

/** Asks for the account password before showing something that holds the Secret Key; forgets it on leaving. */
@Composable
fun PasswordGate(model: AppModel, prompt: String, content: @Composable (secretKey: String) -> Unit) {
    val scope = rememberCoroutineScope()
    var password by remember { mutableStateOf("") }
    var secretKey by remember { mutableStateOf<String?>(null) }
    var wrong by remember { mutableStateOf(false) }
    var checking by remember { mutableStateOf(false) }
    secretKey?.let { content(it); return }
    fun check() {
        if (password.isEmpty() || checking) return
        checking = true
        scope.launch {
            secretKey = model.revealSecretKey(password)
            wrong = secretKey == null
            password = ""
            checking = false
        }
    }
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(if (wrong) "That password isn’t right." else prompt, color = if (wrong) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant)
        PasswordField(password, { password = it }, "Account password", Modifier.fillMaxWidth(), onDone = ::check)
        Button(onClick = ::check, enabled = password.isNotEmpty() && !checking, modifier = Modifier.fillMaxWidth()) {
            if (checking) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp) else Text("Continue")
        }
    }
}
