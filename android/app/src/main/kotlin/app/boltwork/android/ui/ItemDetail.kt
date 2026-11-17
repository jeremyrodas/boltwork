package app.boltwork.android.ui

import android.content.Intent
import android.net.Uri
import android.widget.Toast
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
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material.icons.filled.AttachFile
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.StarBorder
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import app.boltwork.android.AppModel
import app.boltwork.core.Field
import app.boltwork.core.FieldType
import app.boltwork.core.Item
import app.boltwork.core.ItemState
import app.boltwork.core.ItemTemplate
import app.boltwork.core.Totp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** A rounded group of rows. */
@Composable
fun Card(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    Surface(modifier.fillMaxWidth(), shape = MaterialTheme.shapes.large, color = MaterialTheme.colorScheme.surfaceContainer) {
        Column { content() }
    }
}

@Composable
private fun ValueRow(label: String, value: String, mono: Boolean = false, onClick: () -> Unit, trailing: @Composable () -> Unit = {}) {
    Row(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(start = 16.dp, top = 10.dp, bottom = 10.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
            Text(value, style = MaterialTheme.typography.bodyLarge, fontFamily = if (mono) FontFamily.Monospace else null)
        }
        trailing()
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ItemDetailScreen(model: AppModel, item: Item, onBack: () -> Unit, onEdit: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var menu by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf(false) }

    fun copy(what: String, value: String) {
        model.copy(value)
        model.markUsed(item.id)
        Toast.makeText(context, "${what.replaceFirstChar { it.uppercase() }} copied", Toast.LENGTH_SHORT).show()
    }

    @Composable
    fun FieldRow(field: Field) {
        if (field.value.isEmpty()) return
        when (field.type) {
            FieldType.totp -> {
                val totp = remember(field.value) { runCatching { Totp(field.value) }.getOrNull() }
                if (totp == null) {
                    ValueRow(field.label, "This code’s setup isn’t valid", onClick = {})
                } else {
                    val now by produceState(System.currentTimeMillis()) {
                        while (true) {
                            delay(1000 - System.currentTimeMillis() % 1000)
                            value = System.currentTimeMillis()
                        }
                    }
                    val code = totp.code(now)
                    val spaced = if (code.length == 6) code.take(3) + " " + code.drop(3) else code
                    ValueRow(field.label, spaced, mono = true, onClick = { copy("code", code) }) {
                        val left = totp.remaining(now)
                        Text(left.toString(), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        CircularProgressIndicator(progress = { left / totp.period.toFloat() }, modifier = Modifier.padding(horizontal = 12.dp).size(20.dp), strokeWidth = 3.dp)
                    }
                }
            }
            FieldType.concealed -> {
                var shown by remember(field.id) { mutableStateOf(false) }
                ValueRow(field.label, if (shown) field.value else "••••••••••", mono = true, onClick = { copy(field.label, field.value) }) {
                    IconButton(onClick = { shown = !shown }) { Icon(if (shown) Icons.Filled.VisibilityOff else Icons.Filled.Visibility, if (shown) "Hide" else "Show") }
                }
            }
            else -> ValueRow(field.label, field.value, onClick = { copy(field.label, field.value) }) {
                Icon(Icons.Filled.ContentCopy, null, Modifier.padding(horizontal = 12.dp).size(18.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }

    @Composable
    fun FieldCard(title: String, fields: List<Field>) {
        val filled = fields.filter { it.value.isNotEmpty() }
        if (filled.isEmpty()) return
        if (title.isNotEmpty()) Text(title, Modifier.padding(start = 16.dp, top = 8.dp), style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Card {
            filled.forEachIndexed { i, field ->
                if (i > 0) HorizontalDivider(Modifier.padding(start = 16.dp), color = MaterialTheme.colorScheme.outlineVariant)
                FieldRow(field)
            }
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {},
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } },
                actions = {
                    IconButton(onClick = { scope.launch { model.edit { it.setFavorite(item.id, !item.favorite) } } }) {
                        Icon(if (item.favorite) Icons.Filled.Star else Icons.Filled.StarBorder, if (item.favorite) "Remove from favorites" else "Add to favorites")
                    }
                    if (item.state != ItemState.deleted) IconButton(onClick = onEdit) { Icon(Icons.Filled.Edit, "Edit") }
                    IconButton(onClick = { menu = true }) { Icon(Icons.Filled.MoreVert, "More") }
                    DropdownMenu(menu, { menu = false }) {
                        fun act(change: (app.boltwork.core.VaultStore) -> Unit, leave: Boolean = false) {
                            menu = false
                            scope.launch { model.edit(change) }
                            if (leave) onBack()
                        }
                        when (item.state) {
                            ItemState.active -> {
                                DropdownMenuItem({ Text("Archive") }, { act({ it.archive(item.id) }) })
                                DropdownMenuItem({ Text("Move to Recently Deleted") }, { act({ it.trash(item.id) }, leave = true) })
                            }
                            ItemState.archived -> {
                                DropdownMenuItem({ Text("Unarchive") }, { act({ it.restore(item.id) }) })
                                DropdownMenuItem({ Text("Move to Recently Deleted") }, { act({ it.trash(item.id) }, leave = true) })
                            }
                            ItemState.deleted -> {
                                DropdownMenuItem({ Text("Restore") }, { act({ it.restore(item.id) }) })
                                DropdownMenuItem({ Text("Delete Forever") }, { menu = false; confirmDelete = true })
                            }
                        }
                    }
                },
            )
        },
    ) { padding ->
        Column(Modifier.padding(padding).fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                ItemIcon(item.category)
                Column {
                    Text(item.title, style = MaterialTheme.typography.headlineSmall)
                    val vault = model.vaults.firstOrNull { it.id == item.vaultId }?.name
                    Text(listOfNotNull(ItemTemplate.of(item.category).name, vault.takeIf { model.vaults.size > 1 }).joinToString(" · "), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            when (item.state) {
                ItemState.archived -> Text("This item is archived.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                ItemState.deleted -> Text("This item is in Recently Deleted.", color = MaterialTheme.colorScheme.error)
                ItemState.active -> {}
            }

            FieldCard("", item.content.fields)
            if (item.passkeyCount > 0) {
                Card { ValueRow("passkey", "Saved. Use it from Boltwork on your computer, iPhone or iPad.", onClick = {}) }
            }
            if (item.content.urls.isNotEmpty()) {
                Card {
                    item.content.urls.forEachIndexed { i, url ->
                        if (i > 0) HorizontalDivider(Modifier.padding(start = 16.dp), color = MaterialTheme.colorScheme.outlineVariant)
                        ValueRow(url.label.ifEmpty { "website" }, url.url, onClick = { copy("website", url.url) }) {
                            IconButton(onClick = {
                                val address = if (url.url.contains("://")) url.url else "https://${url.url}"
                                runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(address))) }
                            }) { Icon(Icons.AutoMirrored.Filled.OpenInNew, "Open website") }
                        }
                    }
                }
            }
            for (section in item.content.sections) FieldCard(section.title, section.fields)
            if (item.content.notes.isNotEmpty()) {
                Card { ValueRow("notes", item.content.notes, onClick = { copy("notes", item.content.notes) }) }
            }
            if (item.content.tags.isNotEmpty()) {
                Card { ValueRow("tags", item.content.tags.joinToString(", "), onClick = {}) }
            }
            if (item.attachments.isNotEmpty()) {
                Card {
                    for (a in item.attachments) {
                        Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            Icon(Icons.Filled.AttachFile, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                            Column {
                                Text(a.name)
                                Text("${fileSize(a.size)} · open it in Boltwork on another device", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                    }
                }
            }
            Text(
                "Edited ${android.text.format.DateUtils.getRelativeTimeSpanString(item.updatedAt)}",
                Modifier.padding(start = 16.dp, bottom = 24.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }

    if (confirmDelete) {
        AlertDialog(
            onDismissRequest = { confirmDelete = false },
            title = { Text("Delete “${item.title}” forever?") },
            text = { Text("It’s removed from all your devices. This can’t be undone.") },
            confirmButton = {
                TextButton(onClick = {
                    confirmDelete = false
                    scope.launch { model.edit { it.purge(item.id) } }
                    onBack()
                }) { Text("Delete", color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text("Cancel") } },
        )
    }
}

fun fileSize(bytes: Long): String = when {
    bytes < 1024 -> "$bytes bytes"
    bytes < 1024 * 1024 -> "${bytes / 1024} KB"
    else -> "%.1f MB".format(bytes / 1048576.0)
}
