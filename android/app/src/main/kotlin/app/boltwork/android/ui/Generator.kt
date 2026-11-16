package app.boltwork.android.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import app.boltwork.core.GeneratorMode
import app.boltwork.core.GeneratorOptions
import app.boltwork.core.PasswordGenerator
import kotlin.math.roundToInt

@Composable
private fun Toggle(label: String, on: Boolean, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(label, Modifier.weight(1f))
        Switch(on, onChange)
    }
}

@Composable
private fun Stepper(label: String, value: Int, range: IntRange, onChange: (Int) -> Unit) {
    Column {
        Text("$label: $value")
        Slider(value.toFloat(), { onChange(it.roundToInt()) }, valueRange = range.first.toFloat()..range.last.toFloat())
    }
}

@Composable
fun GeneratorDialog(onUse: (String) -> Unit, onDismiss: () -> Unit) {
    var options by remember { mutableStateOf(GeneratorOptions()) }
    var again by remember { mutableIntStateOf(0) }
    val password = remember(options, again) { PasswordGenerator.generate(options) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Generate a Password") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(password, Modifier.weight(1f), fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodyLarge)
                    IconButton(onClick = { again++ }) { Icon(Icons.Filled.Refresh, "Make another") }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    for ((mode, name) in listOf(GeneratorMode.Characters to "Random", GeneratorMode.Words to "Words", GeneratorMode.Pin to "PIN")) {
                        FilterChip(options.mode == mode, { options = options.copy(mode = mode) }, { Text(name) })
                    }
                }
                when (options.mode) {
                    GeneratorMode.Characters -> {
                        Stepper("Length", options.length, 8..64) { options = options.copy(length = it) }
                        Toggle("Numbers", options.digits) { options = options.copy(digits = it) }
                        Toggle("Symbols", options.symbols) { options = options.copy(symbols = it) }
                        Toggle("Avoid look-alike characters", options.avoidAmbiguous) { options = options.copy(avoidAmbiguous = it) }
                    }
                    GeneratorMode.Words -> {
                        Stepper("Words", options.wordCount, 3..10) { options = options.copy(wordCount = it) }
                        Toggle("Capitalize", options.capitalize) { options = options.copy(capitalize = it) }
                    }
                    GeneratorMode.Pin -> Stepper("Digits", options.pinLength, 3..12) { options = options.copy(pinLength = it) }
                }
            }
        },
        confirmButton = { TextButton(onClick = { onUse(password) }) { Text("Use") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}
