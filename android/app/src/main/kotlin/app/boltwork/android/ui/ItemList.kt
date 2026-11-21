package app.boltwork.android.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.filled.ViewList
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Archive
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.CloudOff
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.boltwork.android.AppModel
import app.boltwork.android.SyncStatus
import app.boltwork.core.Item
import app.boltwork.core.ItemCategory
import app.boltwork.core.ItemState
import app.boltwork.core.ItemTemplate
import app.boltwork.core.search
import app.boltwork.core.subtitle

/** Which items the list shows. */
sealed interface Filter {
    val title: String
    fun matches(item: Item): Boolean

    data object All : Filter {
        override val title = "All Items"
        override fun matches(item: Item) = item.state == ItemState.active
    }
    data object Favorites : Filter {
        override val title = "Favorites"
        override fun matches(item: Item) = item.state == ItemState.active && item.favorite
    }
    data class Category(val category: ItemCategory) : Filter {
        override val title get() = ItemTemplate.of(category).pluralName
        override fun matches(item: Item) = item.state == ItemState.active && item.category == category
    }
    data class InVault(val id: String, override val title: String) : Filter {
        override fun matches(item: Item) = item.state == ItemState.active && item.vaultId == id
    }
    data object Archive : Filter {
        override val title = "Archive"
        override fun matches(item: Item) = item.state == ItemState.archived
    }
    data object Trash : Filter {
        override val title = "Recently Deleted"
        override fun matches(item: Item) = item.state == ItemState.deleted
    }
}

@Composable
fun ItemIcon(category: ItemCategory, modifier: Modifier = Modifier) {
    Box(modifier.size(40.dp).clip(RoundedCornerShape(10.dp)).background(MaterialTheme.colorScheme.primaryContainer), contentAlignment = Alignment.Center) {
        Icon(category.icon, null, Modifier.size(22.dp), tint = MaterialTheme.colorScheme.onPrimaryContainer)
    }
}

/** One item in a list: icon, title, subtitle, and a star for favorites. */
@Composable
fun ItemRow(item: Item, onOpen: (String) -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable { onOpen(item.id) }.padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        ItemIcon(item.category)
        Column(Modifier.weight(1f)) {
            Text(item.title, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
            val subtitle = item.content.subtitle
            if (subtitle.isNotEmpty()) {
                Text(subtitle, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        if (item.favorite) Icon(Icons.Filled.Star, "Favorite", Modifier.size(18.dp), tint = MaterialTheme.colorScheme.primary)
    }
}

/** A list name in the plural: "Logins", "Identities", "SSH Keys". */
private val ItemTemplate.pluralName get() =
    if (name.endsWith("y") && name.getOrNull(name.length - 2)?.lowercaseChar() !in "aeiou".toList()) name.dropLast(1) + "ies" else name + "s"

/** The icon beside a filter on the Items tab's first page. */
private val Filter.icon: ImageVector get() = when (this) {
    Filter.All -> Icons.AutoMirrored.Filled.ViewList
    Filter.Favorites -> Icons.Filled.Star
    is Filter.InVault -> Icons.Filled.Folder
    is Filter.Category -> category.icon
    Filter.Archive -> Icons.Filled.Archive
    Filter.Trash -> Icons.Filled.Delete
}

/**
 * The Items tab. With no filter chosen it lists categories (and All Items, Favorites, vaults, Archive and
 * Recently Deleted) with how many items each holds; picking one shows those items. The search field
 * searches every item from the first page, or just the chosen list's items inside one.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ItemsTab(
    model: AppModel, filter: Filter?, onFilter: (Filter?) -> Unit, query: String, onQuery: (String) -> Unit,
    onOpen: (String) -> Unit, onNew: (ItemCategory) -> Unit, accountMenu: @Composable () -> Unit,
) {
    var choosingKind by remember { mutableStateOf(false) }
    BackHandler(filter != null) { onFilter(null); onQuery("") }
    val browsing = filter == null && query.isBlank()
    val shown = remember(model.items, filter, query) {
        model.items.filter((filter ?: Filter.All)::matches).search(query).sortedBy { it.title.lowercase() }
    }
    val lists = remember(model.items, model.vaults) {
        val active = model.items.filter { it.state == ItemState.active }
        buildList {
            add(Filter.All)
            add(Filter.Favorites)
            if (model.vaults.size > 1) model.vaults.forEach { add(Filter.InVault(it.id, it.name)) }
            ItemCategory.entries.filter { c -> active.any { it.category == c } }.forEach { add(Filter.Category(it)) }
            add(Filter.Archive)
            add(Filter.Trash)
        }.map { it to model.items.count(it::matches) }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(filter?.title ?: "Items", maxLines = 1, overflow = TextOverflow.Ellipsis) },
                navigationIcon = {
                    if (filter == null) accountMenu()
                    else IconButton(onClick = { onFilter(null); onQuery("") }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }
                },
            )
        },
        contentWindowInsets = TabInsets,
        floatingActionButton = {
            FloatingActionButton(onClick = { (filter as? Filter.Category)?.let { onNew(it.category) } ?: run { choosingKind = true } }) {
                Icon(Icons.Filled.Add, "New item")
            }
        },
    ) { padding ->
        Column(Modifier.padding(padding).fillMaxSize()) {
            OutlinedTextField(
                query, onQuery, Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
                placeholder = { Text(if (filter == null) "Search all items" else "Search ${filter.title}") }, singleLine = true,
                leadingIcon = { Icon(Icons.Filled.Search, null) },
                trailingIcon = { if (query.isNotEmpty()) IconButton(onClick = { onQuery("") }) { Icon(Icons.Filled.Clear, "Clear search") } },
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search, autoCorrectEnabled = false),
                shape = RoundedCornerShape(28.dp),
            )
            if (browsing) {
                if (model.items.none { it.state == ItemState.active }) {
                    val text = if (model.syncStatus == SyncStatus.Syncing) "Getting your items…" else "No items yet. Tap + to add one."
                    Text(text, Modifier.fillMaxWidth().padding(32.dp), textAlign = TextAlign.Center, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 88.dp)) {
                    items(lists, key = { it.first.toString() }) { (f, count) ->
                        if (f == Filter.Archive || (f is Filter.Category && lists.first { it.first is Filter.Category }.first == f)) {
                            HorizontalDivider(Modifier.padding(vertical = 4.dp))
                        }
                        FilterRow(f, count) { onFilter(f) }
                    }
                }
            } else {
                if (shown.isEmpty()) {
                    val text = if (query.isNotBlank()) "Nothing matches “${query.trim()}”." else "Nothing here."
                    Text(text, Modifier.fillMaxWidth().padding(32.dp), textAlign = TextAlign.Center, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 88.dp)) {
                    items(shown, key = { it.id }) { item -> ItemRow(item, onOpen) }
                }
            }
        }
    }

    if (choosingKind) NewItemSheet(onNew, onDismiss = { choosingKind = false })
}

/** One list on the Items tab's first page: icon, name and how many items it holds. */
@Composable
private fun FilterRow(filter: Filter, count: Int, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Box(Modifier.size(40.dp).clip(RoundedCornerShape(10.dp)).background(MaterialTheme.colorScheme.primaryContainer), contentAlignment = Alignment.Center) {
            Icon(filter.icon, null, Modifier.size(22.dp), tint = MaterialTheme.colorScheme.onPrimaryContainer)
        }
        Text(filter.title, Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Text(count.toString(), color = MaterialTheme.colorScheme.onSurfaceVariant)
        Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

/** Chooses what kind of item to make. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NewItemSheet(onNew: (ItemCategory) -> Unit, onDismiss: () -> Unit) {
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Text("New Item", Modifier.padding(horizontal = 24.dp, vertical = 8.dp), style = MaterialTheme.typography.titleLarge)
        LazyColumn(contentPadding = PaddingValues(bottom = 24.dp)) {
            items(ItemTemplate.all, key = { it.category }) { template ->
                Row(
                    Modifier.fillMaxWidth().clickable { onDismiss(); onNew(template.category) }.padding(horizontal = 24.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp),
                ) {
                    ItemIcon(template.category)
                    Text(template.name, style = MaterialTheme.typography.bodyLarge)
                }
            }
        }
    }
}
