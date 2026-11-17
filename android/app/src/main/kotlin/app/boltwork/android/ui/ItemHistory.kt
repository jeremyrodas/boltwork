package app.boltwork.android.ui

import android.text.format.DateUtils
import android.widget.Toast
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Undo
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import app.boltwork.android.AppModel
import app.boltwork.core.FieldPurpose
import app.boltwork.core.Item
import kotlinx.coroutines.launch

/** Earlier versions of an item, newest first, each restorable. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ItemHistoryScreen(model: AppModel, item: Item, onBack: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var restoring by remember { mutableStateOf<Int?>(null) }

    Scaffold(
        topBar = {
            TopAppBar(title = { Text("Item History") }, navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } })
        },
    ) { padding ->
        LazyColumn(Modifier.padding(padding).fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            itemsIndexed(item.history, key = { _, v -> v.savedAt }) { index, version ->
                Card {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(
                            DateUtils.formatDateTime(context, version.savedAt, DateUtils.FORMAT_SHOW_DATE or DateUtils.FORMAT_SHOW_TIME or DateUtils.FORMAT_SHOW_YEAR),
                            style = MaterialTheme.typography.titleMedium,
                        )
                        Text(version.content.title)
                        version.content.field(FieldPurpose.password)?.value?.let { password ->
                            var shown by remember { mutableStateOf(false) }
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text("Password ", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium)
                                Text(if (shown) password else "••••••••••", Modifier.weight(1f), fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodyMedium)
                                IconButton(onClick = { shown = !shown }) { Icon(if (shown) Icons.Filled.VisibilityOff else Icons.Filled.Visibility, if (shown) "Hide" else "Show") }
                                IconButton(onClick = {
                                    model.copy(password)
                                    Toast.makeText(context, "Old password copied", Toast.LENGTH_SHORT).show()
                                }) { Icon(Icons.Filled.ContentCopy, "Copy old password", Modifier.size(20.dp)) }
                            }
                        }
                        OutlinedButton(onClick = { restoring = index }) {
                            Icon(Icons.AutoMirrored.Filled.Undo, null, Modifier.size(18.dp))
                            Text("  Restore This Version")
                        }
                    }
                }
            }
        }
    }

    restoring?.let { index ->
        AlertDialog(
            onDismissRequest = { restoring = null },
            title = { Text("Restore this version?") },
            text = { Text("The current version is kept in history, so you can switch back.") },
            confirmButton = {
                TextButton(onClick = {
                    restoring = null
                    scope.launch { model.edit { it.restoreVersion(item.id, index) } }
                    onBack()
                }) { Text("Restore") }
            },
            dismissButton = { TextButton(onClick = { restoring = null }) { Text("Cancel") } },
        )
    }
}
