package app.boltwork.android.ui

import android.text.format.DateUtils
import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccessTime
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.CloudDone
import androidx.compose.material.icons.filled.CloudOff
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Password
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Shield
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.automirrored.filled.ViewList
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.ScaffoldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.boltwork.android.AppModel
import app.boltwork.android.R
import app.boltwork.android.SyncStatus
import app.boltwork.core.FieldType
import app.boltwork.core.Item
import app.boltwork.core.ItemCategory
import app.boltwork.core.ItemState
import app.boltwork.core.Totp
import app.boltwork.core.WatchtowerCheck
import app.boltwork.core.search
import app.boltwork.core.subtitle
import kotlinx.coroutines.delay

private sealed interface Screen {
    data class Detail(val id: String) : Screen
    data class Editor(val id: String?, val category: ItemCategory) : Screen
    data class Issues(val check: WatchtowerCheck) : Screen
    data class History(val id: String) : Screen
    data object Settings : Screen
}

enum class Tab(val title: String, val icon: ImageVector) {
    Home("Home", Icons.Filled.Home),
    Items("Items", Icons.AutoMirrored.Filled.ViewList),
    Watchtower("Watchtower", Icons.Filled.Shield),
    Search("Search", Icons.Filled.Search),
}

/** A tab's own bars cover the top; the tab bar below covers the bottom. */
val TabInsets: WindowInsets @Composable get() = ScaffoldDefaults.contentWindowInsets.only(WindowInsetsSides.Top + WindowInsetsSides.Horizontal)

/** Everything behind the lock: Home, Items, Watchtower and Search tabs, and whatever is opened on top of them. */
@Composable
fun VaultScreens(model: AppModel) {
    val context = LocalContext.current
    val stack = remember { mutableStateListOf<Screen>() }
    var tab by rememberSaveable { mutableStateOf(Tab.Home) }
    var filter by remember { mutableStateOf<Filter>(Filter.All) }
    var query by rememberSaveable { mutableStateOf("") }
    var choosingKind by remember { mutableStateOf(false) }
    var generating by remember { mutableStateOf(false) }
    fun back() { if (stack.isNotEmpty()) stack.removeAt(stack.lastIndex) }
    BackHandler(stack.isNotEmpty()) { back() }
    BackHandler(stack.isEmpty() && tab != Tab.Home) { tab = Tab.Home }

    val open: (String) -> Unit = { stack.add(Screen.Detail(it)) }
    val new: (ItemCategory) -> Unit = { stack.add(Screen.Editor(null, it)) }
    val accountMenu: @Composable () -> Unit = {
        AccountMenu(model, onGenerator = { generating = true }, onSettings = { stack.add(Screen.Settings) })
    }

    when (val top = stack.lastOrNull()) {
        null -> Scaffold(
            bottomBar = {
                NavigationBar {
                    for (t in Tab.entries) {
                        NavigationBarItem(selected = tab == t, onClick = { tab = t }, icon = { Icon(t.icon, null) }, label = { Text(t.title) })
                    }
                }
            },
        ) { padding ->
            Box(Modifier.padding(bottom = padding.calculateBottomPadding()).fillMaxSize()) {
                when (tab) {
                    Tab.Home -> HomeTab(model, open, onNew = { choosingKind = true }, accountMenu)
                    Tab.Items -> ItemsTab(model, filter, { filter = it }, query, { query = it }, open, new, accountMenu)
                    Tab.Watchtower -> WatchtowerTab(model, onIssues = { stack.add(Screen.Issues(it)) }, accountMenu)
                    Tab.Search -> SearchTab(model, open)
                }
            }
        }
        is Screen.Detail -> {
            val item = model.item(top.id)
            if (item == null) LaunchedEffect(top) { back() } else ItemDetailScreen(
                model, item, onBack = ::back, onEdit = { stack.add(Screen.Editor(item.id, item.category)) },
                onHistory = { stack.add(Screen.History(item.id)) }, onOpen = open,
            )
        }
        is Screen.Editor -> ItemEditorScreen(model, top.id?.let(model::item), top.category, onDone = { saved ->
            back()
            if (top.id == null && saved != null) stack.add(Screen.Detail(saved.id))
        })
        is Screen.History -> {
            val item = model.item(top.id)
            if (item == null) LaunchedEffect(top) { back() } else ItemHistoryScreen(model, item, onBack = ::back)
        }
        is Screen.Issues -> WatchtowerIssuesScreen(model, top.check, open, onBack = ::back)
        Screen.Settings -> SettingsScreen(model, onBack = ::back)
    }

    if (choosingKind) NewItemSheet(new, onDismiss = { choosingKind = false })
    if (generating) {
        GeneratorDialog(
            onUse = {
                model.copy(it)
                Toast.makeText(context, "Password copied", Toast.LENGTH_SHORT).show()
                generating = false
            },
            onDismiss = { generating = false },
        )
    }
}

/** The round button at the top left: password generator, settings and lock. Shows a dot when sync needs attention. */
@Composable
fun AccountMenu(model: AppModel, onGenerator: () -> Unit, onSettings: () -> Unit) {
    var open by remember { mutableStateOf(false) }
    val problem = model.syncStatus is SyncStatus.Failed || model.syncStatus == SyncStatus.SignedOut
    Box {
        IconButton(onClick = { open = true }) {
            BadgedBox(badge = { if (problem) Badge() }) {
                Image(painterResource(R.drawable.logo), "Account", Modifier.size(30.dp).clip(CircleShape))
            }
        }
        DropdownMenu(open, { open = false }) {
            DropdownMenuItem(text = { Text("Password Generator") }, leadingIcon = { Icon(Icons.Filled.Password, null) }, onClick = { open = false; onGenerator() })
            DropdownMenuItem(
                text = { Text(if (problem) "Settings (sync needs attention)" else "Settings") },
                leadingIcon = { Icon(Icons.Filled.Settings, null) }, onClick = { open = false; onSettings() },
            )
            HorizontalDivider()
            DropdownMenuItem(text = { Text("Lock") }, leadingIcon = { Icon(Icons.Filled.Lock, null) }, onClick = { open = false; model.lock() })
        }
    }
}

// Home

/** The first tab: live one-time codes, then favorites and recent items in cards. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun HomeTab(model: AppModel, onOpen: (String) -> Unit, onNew: () -> Unit, accountMenu: @Composable () -> Unit) {
    val active = remember(model.items) { model.items.filter { it.state == ItemState.active } }
    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("Home")
                        val subtitle = if (model.vaults.size == 1) model.vaults[0].name else "${model.vaults.size} vaults"
                        if (model.vaults.isNotEmpty()) Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                },
                navigationIcon = accountMenu,
                actions = { IconButton(onClick = onNew) { Icon(Icons.Filled.Add, "New item") } },
            )
        },
        contentWindowInsets = TabInsets,
    ) { padding ->
        Column(
            Modifier.padding(padding).fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp),
        ) {
            val codes = remember(active) { withCodes(active) }
            if (codes.isNotEmpty()) {
                LazyRow(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    items(codes, key = { it.id }) { OneTimeCodeCard(model, it) }
                }
            }
            if (active.isEmpty()) WelcomeCard(onNew)
            HomeSection("Favorites", Icons.Filled.Star, Color(0xFFE0A800), active.filter { it.favorite }.sortedBy { it.title.lowercase() }, onOpen)
            HomeSection(
                "Recently Used", Icons.Filled.AccessTime, MaterialTheme.colorScheme.primary,
                active.filter { it.lastUsedAt != null }.sortedByDescending { it.lastUsedAt }.take(6), onOpen,
            )
            HomeSection("Recently Created", Icons.Filled.AutoAwesome, Color(0xFF2A9D8F), active.sortedByDescending { it.createdAt }.take(6), onOpen)
            SyncStatusFooter(model)
        }
    }
}

/** Items with a one-time code, favorites first, then the most used. */
private fun withCodes(items: List<Item>) = items
    .filter { item -> item.content.allFields.any { it.type == FieldType.totp && it.value.isNotEmpty() } }
    .sortedWith(compareByDescending<Item> { it.favorite }.thenByDescending { it.useCount })
    .take(12)

@Composable
private fun OneTimeCodeCard(model: AppModel, item: Item) {
    val context = LocalContext.current
    val totp = remember(item) { item.content.allFields.firstOrNull { it.type == FieldType.totp && it.value.isNotEmpty() }?.let { runCatching { Totp(it.value) }.getOrNull() } }
        ?: return
    val now by produceState(System.currentTimeMillis()) {
        while (true) {
            delay(1000 - System.currentTimeMillis() % 1000)
            value = System.currentTimeMillis()
        }
    }
    val code = totp.code(now)
    Surface(
        Modifier.width(170.dp).clip(MaterialTheme.shapes.large).clickable {
            model.copy(code)
            model.markUsed(item.id)
            Toast.makeText(context, "Code copied", Toast.LENGTH_SHORT).show()
        },
        shape = MaterialTheme.shapes.large, color = MaterialTheme.colorScheme.surfaceContainer,
    ) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Icon(item.category.icon, null, Modifier.size(16.dp), tint = MaterialTheme.colorScheme.primary)
                Text(item.title, style = MaterialTheme.typography.labelLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            Text("one-time code", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary)
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(if (code.length == 6) code.take(3) + " " + code.drop(3) else code, style = MaterialTheme.typography.titleMedium, fontFamily = FontFamily.Monospace)
                val left = totp.remaining(now)
                CircularProgressIndicator(progress = { left / totp.period.toFloat() }, modifier = Modifier.size(16.dp), strokeWidth = 2.dp)
            }
        }
    }
}

@Composable
private fun WelcomeCard(onNew: () -> Unit) {
    Surface(shape = MaterialTheme.shapes.large, color = Color(0xFF1F2430), contentColor = Color.White, modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Image(painterResource(R.drawable.logo), null, Modifier.size(44.dp).clip(RoundedCornerShape(10.dp)))
            Text("Set up your vault", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
            Text("Add your first login, card or note. Favorites, recent items and one-time codes will show up here.", color = Color.White.copy(alpha = 0.75f))
            Button(onClick = onNew) { Icon(Icons.Filled.Add, null); Text(" Add an Item") }
        }
    }
}

/** A card of items that folds away. */
@Composable
private fun HomeSection(title: String, icon: ImageVector, tint: Color, items: List<Item>, onOpen: (String) -> Unit) {
    if (items.isEmpty()) return
    var expanded by rememberSaveable(title) { mutableStateOf(true) }
    Card(Modifier.animateContentSize()) {
        Row(
            Modifier.fillMaxWidth().clickable { expanded = !expanded }.padding(14.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Box(Modifier.size(28.dp).clip(CircleShape).background(tint), contentAlignment = Alignment.Center) {
                Icon(icon, null, Modifier.size(16.dp), tint = Color.White)
            }
            Text(title, Modifier.weight(1f), style = MaterialTheme.typography.titleMedium)
            Icon(Icons.Filled.ExpandMore, if (expanded) "Collapse" else "Expand", Modifier.rotate(if (expanded) 0f else -90f), tint = MaterialTheme.colorScheme.primary)
        }
        if (expanded) {
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            items.forEachIndexed { i, item ->
                if (i > 0) HorizontalDivider(Modifier.padding(start = 70.dp), color = MaterialTheme.colorScheme.outlineVariant)
                ItemRow(item, onOpen)
            }
        }
    }
}

@Composable
private fun SyncStatusFooter(model: AppModel) {
    if (model.account == null) return
    Row(Modifier.fillMaxWidth().padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        val style = MaterialTheme.typography.bodySmall
        val muted = MaterialTheme.colorScheme.onSurfaceVariant
        when (val status = model.syncStatus) {
            SyncStatus.Syncing -> { CircularProgressIndicator(Modifier.size(12.dp), strokeWidth = 2.dp); Text("Syncing…", style = style, color = muted) }
            is SyncStatus.Failed -> { Icon(Icons.Filled.CloudOff, null, Modifier.size(16.dp), tint = Color(0xFFE08A00)); Text("Sync failed: ${status.message}", style = style, color = muted) }
            SyncStatus.SignedOut -> { Icon(Icons.Filled.CloudOff, null, Modifier.size(16.dp), tint = Color(0xFFE08A00)); Text("Signed out of sync", style = style, color = muted) }
            SyncStatus.Idle -> {
                Icon(Icons.Filled.CloudDone, null, Modifier.size(16.dp), tint = muted)
                Text(model.account?.lastSyncAt?.let { "Synced ${DateUtils.getRelativeTimeSpanString(it)}" } ?: "Sync is on", style = style, color = muted)
            }
        }
    }
}

// Search

/** Searches every item. Before typing, shows the most recently used. */
@Composable
private fun SearchTab(model: AppModel, onOpen: (String) -> Unit) {
    var query by rememberSaveable { mutableStateOf("") }
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { delay(150); runCatching { focus.requestFocus() } }
    val results = remember(model.items, query) {
        val active = model.items.filter { it.state == ItemState.active }
        if (query.isBlank()) active.filter { it.lastUsedAt != null }.sortedByDescending { it.lastUsedAt }.take(10)
        else active.search(query).sortedWith(compareByDescending<Item> { it.useCount }.thenBy { it.title.lowercase() })
    }
    Scaffold(contentWindowInsets = TabInsets) { padding ->
        Column(Modifier.padding(padding).fillMaxSize()) {
            OutlinedTextField(
                query, { query = it }, Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp).focusRequester(focus),
                placeholder = { Text("Search all items") }, singleLine = true, shape = RoundedCornerShape(28.dp),
                leadingIcon = { Icon(Icons.Filled.Search, null) },
                trailingIcon = { if (query.isNotEmpty()) IconButton(onClick = { query = "" }) { Icon(Icons.Filled.Clear, "Clear search") } },
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search, autoCorrectEnabled = false),
            )
            when {
                query.isNotBlank() && results.isEmpty() ->
                    Text("Nothing matches “${query.trim()}”.", Modifier.fillMaxWidth().padding(32.dp), textAlign = TextAlign.Center, color = MaterialTheme.colorScheme.onSurfaceVariant)
                query.isBlank() && results.isEmpty() -> Column(Modifier.fillMaxWidth().padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Icon(Icons.Filled.Search, null, Modifier.size(40.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                    Spacer(Modifier.height(8.dp))
                    Text("Search Your Vault", style = MaterialTheme.typography.titleMedium)
                    Text("Find items by title, username, website, tag or note.", textAlign = TextAlign.Center, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 16.dp)) {
                if (query.isBlank() && results.isNotEmpty()) {
                    item { Text("Recently Used", Modifier.padding(start = 16.dp, top = 8.dp, bottom = 4.dp), style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                }
                items(results, key = { it.id }) { ItemRow(it, onOpen) }
            }
        }
    }
}
