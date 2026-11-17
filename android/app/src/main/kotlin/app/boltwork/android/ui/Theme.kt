package app.boltwork.android.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccountBalance
import androidx.compose.material.icons.filled.Album
import androidx.compose.material.icons.filled.Badge
import androidx.compose.material.icons.filled.CardGiftcard
import androidx.compose.material.icons.filled.CardMembership
import androidx.compose.material.icons.filled.CreditCard
import androidx.compose.material.icons.filled.CurrencyBitcoin
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.DirectionsCar
import androidx.compose.material.icons.filled.Dns
import androidx.compose.material.icons.filled.Email
import androidx.compose.material.icons.filled.Extension
import androidx.compose.material.icons.filled.Forest
import androidx.compose.material.icons.filled.Key
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.MedicalServices
import androidx.compose.material.icons.filled.Public
import androidx.compose.material.icons.filled.Router
import androidx.compose.material.icons.filled.Storage
import androidx.compose.material.icons.filled.Terminal
import androidx.compose.material.icons.filled.TextSnippet
import androidx.compose.material.icons.filled.VerifiedUser
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import app.boltwork.android.AppModel
import app.boltwork.android.Phase
import app.boltwork.core.ItemCategory

private val Brass = Color(0xFF84621C)
private val BrassLight = Color(0xFFD4B06A)
private val Graphite = Color(0xFF1F2430)

private val LightColors = lightColorScheme(
    primary = Brass, onPrimary = Color.White, primaryContainer = Color(0xFFF1E3C2), onPrimaryContainer = Color(0xFF2B2006),
    secondary = Brass, onSecondary = Color.White, secondaryContainer = Color(0xFFEFE6D2), onSecondaryContainer = Color(0xFF2B2006),
    tertiary = Brass, background = Color(0xFFFAF9F6), onBackground = Graphite, surface = Color(0xFFFAF9F6), onSurface = Graphite,
    surfaceVariant = Color(0xFFEBE8E1), onSurfaceVariant = Color(0xFF5A5E69), outline = Color(0xFF8B8E97), outlineVariant = Color(0xFFD9D6CE),
    surfaceContainerLowest = Color.White, surfaceContainerLow = Color(0xFFF5F3EE), surfaceContainer = Color(0xFFF0EEE8),
    surfaceContainerHigh = Color(0xFFEAE8E2), surfaceContainerHighest = Color(0xFFE4E2DC),
)

private val DarkColors = darkColorScheme(
    primary = BrassLight, onPrimary = Graphite, primaryContainer = Color(0xFF4D3D17), onPrimaryContainer = Color(0xFFF1E3C2),
    secondary = BrassLight, onSecondary = Graphite, secondaryContainer = Color(0xFF3A3525), onSecondaryContainer = Color(0xFFF1E3C2),
    tertiary = BrassLight, background = Color(0xFF14171F), onBackground = Color(0xFFE7E8EC), surface = Color(0xFF14171F), onSurface = Color(0xFFE7E8EC),
    surfaceVariant = Color(0xFF2A2F3C), onSurfaceVariant = Color(0xFFA9ADB8), outline = Color(0xFF747986), outlineVariant = Color(0xFF343947),
    surfaceContainerLowest = Color(0xFF0F1218), surfaceContainerLow = Color(0xFF191D26), surfaceContainer = Color(0xFF1F2430),
    surfaceContainerHigh = Color(0xFF262B38), surfaceContainerHighest = Color(0xFF2E3442),
)

@Composable
fun BoltworkTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = if (isSystemInDarkTheme()) DarkColors else LightColors) {
        Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background, content = content)
    }
}

@Composable
fun BoltworkApp(model: AppModel) {
    BoltworkTheme {
        run {
            when (model.phase) {
                Phase.SignedOut -> WelcomeScreen(model)
                Phase.Locked -> LockScreen(model)
                Phase.Unlocked -> model.newSecretKey?.let { NewSecretKeyScreen(it, onDone = { model.newSecretKey = null }) } ?: VaultScreens(model)
            }
        }
    }
}

val ItemCategory.icon: ImageVector
    get() = when (this) {
        ItemCategory.login -> Icons.Filled.Key
        ItemCategory.password -> Icons.Filled.Lock
        ItemCategory.secureNote -> Icons.Filled.TextSnippet
        ItemCategory.creditCard -> Icons.Filled.CreditCard
        ItemCategory.identity -> Icons.Filled.Badge
        ItemCategory.document -> Icons.Filled.Description
        ItemCategory.bankAccount -> Icons.Filled.AccountBalance
        ItemCategory.database -> Icons.Filled.Storage
        ItemCategory.driverLicense -> Icons.Filled.DirectionsCar
        ItemCategory.emailAccount -> Icons.Filled.Email
        ItemCategory.membership -> Icons.Filled.CardMembership
        ItemCategory.outdoorLicense -> Icons.Filled.Forest
        ItemCategory.passport -> Icons.Filled.Public
        ItemCategory.rewardProgram -> Icons.Filled.CardGiftcard
        ItemCategory.router -> Icons.Filled.Router
        ItemCategory.server -> Icons.Filled.Dns
        ItemCategory.socialSecurityNumber -> Icons.Filled.VerifiedUser
        ItemCategory.softwareLicense -> Icons.Filled.Album
        ItemCategory.apiCredential -> Icons.Filled.Extension
        ItemCategory.cryptoWallet -> Icons.Filled.CurrencyBitcoin
        ItemCategory.medicalRecord -> Icons.Filled.MedicalServices
        ItemCategory.sshKey -> Icons.Filled.Terminal
    }
