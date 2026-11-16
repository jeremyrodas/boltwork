package app.boltwork.android.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.RemoveCircleOutline
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
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
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import app.boltwork.android.AppModel
import app.boltwork.core.Field
import app.boltwork.core.FieldPurpose
import app.boltwork.core.FieldType
import app.boltwork.core.Item
import app.boltwork.core.ItemCategory
import app.boltwork.core.ItemContent
import app.boltwork.core.ItemTemplate
import app.boltwork.core.ItemUrl
import app.boltwork.core.Section
import app.boltwork.core.VaultCrypto
import kotlinx.coroutines.launch

/** A read-only box that opens a menu of choices. */
@Composable
private fun MenuField(label: String, value: String, options: List<String>, onPick: (String) -> Unit, modifier: Modifier = Modifier) {
    var open by remember { mutableStateOf(false) }
    Box(modifier) {
        OutlinedTextField(
            value, {}, Modifier.fillMaxWidth(), label = { Text(label) }, readOnly = true, singleLine = true,
            trailingIcon = { IconButton(onClick = { open = true }) { Icon(Icons.Filled.ArrowDropDown, "Choose") } },
        )
        DropdownMenu(open, { open = false }) {
            for (option in options) DropdownMenuItem({ Text(option.ifEmpty { "None" }) }, { open = false; onPick(option) })
        }
    }
}

@Composable
private fun FieldEditor(field: Field, onChange: (Field) -> Unit, onGenerate: () -> Unit) {
    val wide = Modifier.fillMaxWidth()
    fun set(value: String) = onChange(field.copy(value = value))
    fun keyboard(type: KeyboardType) = KeyboardOptions(keyboardType = type, autoCorrectEnabled = false)
    when (field.type) {
        FieldType.menu -> MenuField(field.label, field.value, listOf("") + field.options.orEmpty(), ::set, wide)
        FieldType.concealed -> PasswordField(field.value, ::set, field.label, wide) {
            if (field.purpose == FieldPurpose.password) IconButton(onClick = onGenerate) { Icon(Icons.Filled.AutoAwesome, "Generate a password") }
        }
        FieldType.multiline -> OutlinedTextField(field.value, ::set, wide, label = { Text(field.label) }, minLines = 3)
        FieldType.totp -> OutlinedTextField(
            field.value, ::set, wide, label = { Text(field.label) }, singleLine = true, keyboardOptions = keyboard(KeyboardType.Password),
            supportingText = { Text("The setup key the website shows when you turn on two-step sign-in.") },
        )
        FieldType.email -> OutlinedTextField(field.value, ::set, wide, label = { Text(field.label) }, singleLine = true, keyboardOptions = keyboard(KeyboardType.Email))
        FieldType.phone -> OutlinedTextField(field.value, ::set, wide, label = { Text(field.label) }, singleLine = true, keyboardOptions = keyboard(KeyboardType.Phone))
        FieldType.url -> OutlinedTextField(field.value, ::set, wide, label = { Text(field.label) }, singleLine = true, keyboardOptions = keyboard(KeyboardType.Uri))
        FieldType.date -> OutlinedTextField(field.value, ::set, wide, label = { Text(field.label) }, singleLine = true, placeholder = { Text("YYYY-MM-DD") })
        FieldType.monthYear -> OutlinedTextField(field.value, ::set, wide, label = { Text(field.label) }, singleLine = true, placeholder = { Text("MM/YYYY") })
        FieldType.text -> OutlinedTextField(
            field.value, ::set, wide, label = { Text(field.label) }, singleLine = true,
            keyboardOptions = if (field.purpose == FieldPurpose.username) keyboard(KeyboardType.Email) else KeyboardOptions.Default,
        )
    }
}

/** Makes a new item (`item` null) or changes one. `onDone` gets the saved item, or null if the user backed out. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ItemEditorScreen(model: AppModel, item: Item?, category: ItemCategory, onDone: (Item?) -> Unit) {
    val scope = rememberCoroutineScope()
    val template = ItemTemplate.of(category)
    val original = remember { item?.content ?: ItemTemplate.blankContent(category) }
    var content by remember { mutableStateOf(original) }
    var urls by remember { mutableStateOf(original.urls.ifEmpty { if (template.hasUrls && item == null) listOf(ItemUrl(url = "")) else emptyList() }) }
    var tags by remember { mutableStateOf(original.tags.joinToString(", ")) }
    var vaultId by remember { mutableStateOf(item?.vaultId ?: model.vaults.firstOrNull()?.id.orEmpty()) }
    var generatingFor by remember { mutableStateOf<String?>(null) }
    var confirmDiscard by remember { mutableStateOf(false) }
    var saving by remember { mutableStateOf(false) }

    fun result() = content.copy(urls = urls.filter { it.url.isNotBlank() }.map { it.copy(url = it.url.trim()) }, tags = tags.split(","))
    fun changed() = result().let { it.copy(tags = it.tags.map(String::trim).filter(String::isNotEmpty)) } != original || vaultId != (item?.vaultId ?: vaultId)
    fun leave() { if (changed()) confirmDiscard = true else onDone(null) }
    fun setField(changed: Field) {
        content = content.copy(
            fields = content.fields.map { if (it.id == changed.id) changed else it },
            sections = content.sections.map { s -> s.copy(fields = s.fields.map { if (it.id == changed.id) changed else it }) },
        )
    }
    fun addCustom(type: FieldType) {
        val field = Field(VaultCrypto.randomId(), "", type)
        val sections = content.sections
        content = content.copy(
            sections = if (sections.isEmpty()) listOf(Section(VaultCrypto.randomId(), "", listOf(field)))
            else sections.dropLast(1) + sections.last().let { it.copy(fields = it.fields + field) },
        )
    }
    BackHandler { leave() }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(if (item == null) "New ${template.name}" else "Edit") },
                navigationIcon = { IconButton(onClick = ::leave) { Icon(Icons.Filled.Close, "Cancel") } },
                actions = {
                    TextButton(enabled = !saving && vaultId.isNotEmpty(), onClick = {
                        saving = true
                        scope.launch { onDone(model.edit { it.saveItem(item?.id, vaultId, result()) }) }
                    }) { Text("Save") }
                },
            )
        },
    ) { padding ->
        Column(
            Modifier.padding(padding).fillMaxSize().imePadding().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            OutlinedTextField(
                content.title, { content = content.copy(title = it) }, Modifier.fillMaxWidth(), label = { Text("Title") }, singleLine = true,
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Words),
            )
            if (model.vaults.size > 1) {
                MenuField("Vault", model.vaults.firstOrNull { it.id == vaultId }?.name.orEmpty(), model.vaults.map { it.name }, { name ->
                    model.vaults.firstOrNull { it.name == name }?.let { vaultId = it.id }
                }, Modifier.fillMaxWidth())
            }
            for (field in content.fields) FieldEditor(field, ::setField) { generatingFor = field.id }

            if (template.hasUrls || urls.isNotEmpty()) {
                urls.forEachIndexed { i, url ->
                    OutlinedTextField(
                        url.url, { text -> urls = urls.mapIndexed { j, u -> if (j == i) u.copy(url = text) else u } }, Modifier.fillMaxWidth(),
                        label = { Text(url.label.ifEmpty { "website" }) }, singleLine = true, placeholder = { Text("example.com") },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, autoCorrectEnabled = false),
                        trailingIcon = { IconButton(onClick = { urls = urls.filterIndexed { j, _ -> j != i } }) { Icon(Icons.Filled.RemoveCircleOutline, "Remove website") } },
                    )
                }
                TextButton(onClick = { urls = urls + ItemUrl(url = "") }) {
                    Icon(Icons.Filled.Add, null)
                    Text(" Add Website")
                }
            }

            for (section in content.sections) {
                if (section.title.isNotEmpty()) Text(section.title, style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                for (field in section.fields) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedTextField(field.label, { setField(field.copy(label = it)) }, Modifier.weight(0.4f), label = { Text("Label") }, singleLine = true)
                        Box(Modifier.weight(0.6f)) { FieldEditor(field.copy(label = if (field.type == FieldType.concealed) "Hidden value" else "Value"), { setField(it.copy(label = field.label)) }) {} }
                    }
                }
            }
            Row {
                TextButton(onClick = { addCustom(FieldType.text) }) {
                    Icon(Icons.Filled.Add, null)
                    Text(" Add Field")
                }
                TextButton(onClick = { addCustom(FieldType.concealed) }) {
                    Icon(Icons.Filled.Add, null)
                    Text(" Add Hidden Field")
                }
            }

            OutlinedTextField(content.notes, { content = content.copy(notes = it) }, Modifier.fillMaxWidth(), label = { Text("Notes") }, minLines = 3)
            OutlinedTextField(
                tags, { tags = it }, Modifier.fillMaxWidth().padding(bottom = 24.dp), label = { Text("Tags") }, singleLine = true,
                supportingText = { Text("Separate tags with commas.") },
            )
        }
    }

    generatingFor?.let { id ->
        GeneratorDialog(onUse = { password ->
            content.allFields.firstOrNull { it.id == id }?.let { setField(it.copy(value = password)) }
            generatingFor = null
        }, onDismiss = { generatingFor = null })
    }

    if (confirmDiscard) {
        AlertDialog(
            onDismissRequest = { confirmDiscard = false },
            title = { Text("Discard your changes?") },
            confirmButton = { TextButton(onClick = { confirmDiscard = false; onDone(null) }) { Text("Discard", color = MaterialTheme.colorScheme.error) } },
            dismissButton = { TextButton(onClick = { confirmDiscard = false }) { Text("Keep Editing") } },
        )
    }
}
