package app.boltwork.android.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.GppBad
import androidx.compose.material.icons.filled.Key
import androidx.compose.material.icons.filled.LockOpen
import androidx.compose.material.icons.filled.Repeat
import androidx.compose.material.icons.filled.SignalWifiOff
import androidx.compose.material.icons.filled.VerifiedUser
import androidx.compose.material.icons.filled.WaterDrop
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.boltwork.android.AppModel
import app.boltwork.core.FieldPurpose
import app.boltwork.core.ItemState
import app.boltwork.core.PasswordStrength
import app.boltwork.core.Watchtower
import app.boltwork.core.WatchtowerCheck

/**
 * Binoculars for the Lookout tab, which Material icons don't have. Drawn from Lucide's "binoculars"
 * (ISC license, Copyright (c) Lucide Contributors), the same icon the desktop app uses.
 */
val Binoculars: ImageVector by lazy {
    ImageVector.Builder("Binoculars", 24.dp, 24.dp, 24f, 24f).apply {
        listOf(
            "M10 10h4",
            "M19 7V4a1 1 0 0 0-1-1h-2a1 1 0 0 0-1 1v3",
            "M20 21a2 2 0 0 0 2-2v-3.851c0-1.39-2-2.962-2-4.829V8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v11a2 2 0 0 0 2 2z",
            "M22 16L2 16",
            "M4 21a2 2 0 0 1-2-2v-3.851c0-1.39 2-2.962 2-4.829V8a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v11a2 2 0 0 1-2 2z",
            "M9 7V4a1 1 0 0 0-1-1H6a1 1 0 0 0-1 1v3",
        ).forEach { d ->
            addPath(
                PathParser().parsePathString(d).toNodes(),
                stroke = SolidColor(Color.Black), strokeLineWidth = 2f,
                strokeLineCap = StrokeCap.Round, strokeLineJoin = StrokeJoin.Round,
            )
        }
    }.build()
}

private val Good = Color(0xFF2E9E5B)
private val Warn = Color(0xFFE0A800)
private val Bad = Color(0xFFD64545)

val WatchtowerCheck.icon: ImageVector
    get() = when (this) {
        WatchtowerCheck.compromisedWebsite -> Icons.Filled.GppBad
        WatchtowerCheck.vulnerable -> Icons.Filled.WaterDrop
        WatchtowerCheck.weak -> Icons.Filled.LockOpen
        WatchtowerCheck.reused -> Icons.Filled.Repeat
        WatchtowerCheck.unsecured -> Icons.Filled.SignalWifiOff
        WatchtowerCheck.inactive2fa -> Icons.Filled.Key
        WatchtowerCheck.expiring -> Icons.Filled.CalendarMonth
        WatchtowerCheck.duplicate -> Icons.Filled.ContentCopy
    }

private fun scoreColor(score: Int, brass: Color) = when {
    score > 800 -> Good; score > 600 -> brass; score > 400 -> Warn; else -> Bad
}

/** The Watchtower tab: the score, password strength, and a card for each kind of problem. */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun WatchtowerTab(model: AppModel, onIssues: (WatchtowerCheck) -> Unit, accountMenu: @Composable () -> Unit) {
    val report = remember(model.items, model.pwnedCounts) { Watchtower.run(model.items, model.pwnedCounts) }
    val passwords = remember(model.items) {
        model.items.filter { it.state == ItemState.active }.mapNotNull { it.content.field(FieldPurpose.password)?.value }.filter { it.isNotEmpty() }
    }
    var checking by remember { mutableStateOf(false) }
    LaunchedEffect(model.checkBreaches, model.items) {
        if (!model.checkBreaches) return@LaunchedEffect
        checking = true
        try { model.lookUpBreaches() } finally { checking = false }
    }

    Scaffold(topBar = { TopAppBar(title = { Text("Lookout") }, navigationIcon = accountMenu) }, contentWindowInsets = TabInsets) { padding ->
        Column(
            Modifier.padding(padding).fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
            horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(20.dp),
        ) {
            ScoreGauge(report.score, report.scoreLabel)
            Text(
                "Lookout looks for weak, reused and exposed passwords and other risks. Fix the flagged items to raise your score.",
                Modifier.widthIn(max = 480.dp), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center,
            )
            StrengthBreakdown(passwords)
            val checks = WatchtowerCheck.entries.filter { report.count(it) > 0 }
            if (checks.isEmpty()) {
                Card {
                    Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Icon(Icons.Filled.VerifiedUser, null, tint = Good)
                        Text("All clear. Lookout found nothing to fix.", color = Good)
                    }
                }
            } else {
                FlowRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(12.dp), maxItemsInEachRow = 2) {
                    for (check in checks) IssueCountCard(check, report.count(check), Modifier.weight(1f)) { onIssues(check) }
                    if (checks.size % 2 == 1) Spacer(Modifier.weight(1f))
                }
            }
            Card {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("Check for breached passwords", Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
                        if (checking) CircularProgressIndicator(Modifier.padding(end = 12.dp).size(18.dp), strokeWidth = 2.dp)
                        Switch(model.checkBreaches, model::changeCheckBreaches)
                    }
                    Text(
                        "Sends only the first five characters of each password’s SHA-1 hash to a public breach database. Your passwords never leave this device.",
                        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}

/** The security score on an open arc, colored by how good it is. */
@Composable
private fun ScoreGauge(score: Int, label: String) {
    val color = scoreColor(score, MaterialTheme.colorScheme.primary)
    val track = MaterialTheme.colorScheme.outlineVariant
    Box(Modifier.size(220.dp).padding(bottom = 0.dp), contentAlignment = Alignment.Center) {
        Canvas(Modifier.fillMaxSize().padding(12.dp)) {
            val stroke = Stroke(width = 18.dp.toPx(), cap = StrokeCap.Round)
            val inset = stroke.width / 2
            val arcSize = Size(size.width - stroke.width, size.height - stroke.width)
            drawArc(track, 135f, 270f, false, Offset(inset, inset), arcSize, style = stroke)
            drawArc(color, 135f, 270f * score / 1000f, false, Offset(inset, inset), arcSize, style = stroke)
        }
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(score.toString(), fontSize = 52.sp, fontWeight = FontWeight.Bold)
            Text(label.uppercase(), style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

/** How strong the vault's passwords are, as one bar split from weakest to strongest. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun StrengthBreakdown(passwords: List<String>) {
    val bands = listOf(
        Triple("Terrible", 0..2, Bad), Triple("Weak", 3..3, Color(0xFFE07A1F)), Triple("Fair", 4..4, Warn),
        Triple("Good", 5..5, Color(0xFF5CC8A8)), Triple("Excellent", 6..7, Good),
    )
    val levels = remember(passwords) { passwords.map { PasswordStrength(it).level } }
    val counts = bands.map { (_, range, _) -> levels.count { it in range } }
    Card {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("Overall Password Strength", style = MaterialTheme.typography.titleMedium)
            if (levels.isEmpty()) {
                Text("No passwords yet.", color = MaterialTheme.colorScheme.onSurfaceVariant)
            } else {
                Row(Modifier.fillMaxWidth().height(14.dp).clip(CircleShape), horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                    bands.forEachIndexed { i, band -> if (counts[i] > 0) Box(Modifier.weight(counts[i].toFloat()).fillMaxSize().background(band.third)) }
                }
                FlowRow(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    bands.forEachIndexed { i, band ->
                        if (counts[i] > 0) Row(verticalAlignment = Alignment.CenterVertically) {
                            Box(Modifier.size(8.dp).clip(CircleShape).background(band.third))
                            Text(" ${counts[i]} ${band.first}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
            }
        }
    }
}

/** A big number for one kind of problem, such as reused passwords. */
@Composable
private fun IssueCountCard(check: WatchtowerCheck, count: Int, modifier: Modifier, onClick: () -> Unit) {
    Surface(modifier.clip(MaterialTheme.shapes.large).clickable(onClick = onClick), shape = MaterialTheme.shapes.large, color = MaterialTheme.colorScheme.surfaceContainer) {
        Column(Modifier.heightIn(min = 110.dp).padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(count.toString(), Modifier.weight(1f), fontSize = 34.sp, fontWeight = FontWeight.Bold)
                Icon(check.icon, null, tint = Bad.copy(alpha = 0.7f))
            }
            Text(check.title, style = MaterialTheme.typography.titleSmall)
        }
    }
}

/** The items with one kind of problem. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WatchtowerIssuesScreen(model: AppModel, check: WatchtowerCheck, onOpen: (String) -> Unit, onBack: () -> Unit) {
    val issues = remember(model.items, model.pwnedCounts) { Watchtower.run(model.items, model.pwnedCounts).issues.filter { it.check == check } }
    Scaffold(
        topBar = {
            TopAppBar(title = { Text(check.title) }, navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } })
        },
    ) { padding ->
        LazyColumn(Modifier.padding(padding).fillMaxSize()) {
            if (issues.isEmpty()) item { Text("Nothing left to fix here.", Modifier.fillMaxWidth().padding(32.dp), textAlign = TextAlign.Center, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            items(issues, key = { it.itemId }) { issue ->
                val item = model.item(issue.itemId) ?: return@items
                Row(
                    Modifier.fillMaxWidth().clickable { onOpen(item.id) }.padding(horizontal = 16.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp),
                ) {
                    ItemIcon(item.content)
                    Column(Modifier.weight(1f)) {
                        Text(item.title, style = MaterialTheme.typography.bodyLarge)
                        Text(issue.detail, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
    }
}
