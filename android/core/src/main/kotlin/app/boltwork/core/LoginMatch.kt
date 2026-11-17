package app.boltwork.core

/**
 * Which logins belong to the website or app asking to fill. Websites match by registrable domain, as on iPhone.
 * Android apps match a saved `androidapp://<package>` address, or a website whose domain is the package name
 * reversed (com.example.app → example.com).
 */
class LoginMatch(webDomain: String?, val packageName: String?, val appName: String? = null) {
    val domain: String? = webDomain?.trim()?.lowercase()?.removePrefix("www.")?.takeIf { it.isNotEmpty() }
    private val base: String? = domain?.let { Domain.base(it) }

    /** A guess from the package name. Any app can choose its package name, so this only suggests, never fills directly. */
    private val guessedBase: String? = if (domain != null || packageName == null) null else
        packageName.lowercase().split('.').filter { it.isNotEmpty() }.takeIf { it.size >= 2 }?.let { Domain.base(it.reversed().joinToString(".")) }

    /** The address to save on a new login for this site or app. */
    val saveAddress: String? get() = domain?.let { "https://$it" } ?: packageName?.let { "$APP_SCHEME$it" }

    /** What to call the site or app when asking the user. */
    val label: String get() = domain ?: appName?.takeIf { it.isNotBlank() } ?: packageName ?: "this app"

    /** Whether the login is for this site or app. With [guesses], also logins whose website matches the reversed package name. */
    fun matches(item: Item, guesses: Boolean = false): Boolean = item.content.urls.any { u ->
        val url = u.url.trim()
        if (url.lowercase().startsWith(APP_SCHEME)) packageName != null && domain == null && url.substring(APP_SCHEME.length).trimEnd('/') == packageName
        else Domain.host(url).takeIf { it.isNotEmpty() }?.let { Domain.base(it) }?.let { it == base || (guesses && it == guessedBase) } == true
    }

    /** Active logins with a password that match, most used first. */
    fun logins(items: List<Item>, guesses: Boolean = false): List<Item> = items
        .filter { it.state == ItemState.active && it.category == ItemCategory.login && it.content.field(FieldPurpose.password) != null && matches(it, guesses) }
        .sortedWith(compareByDescending<Item> { it.useCount }.thenBy { it.title.lowercase() })

    companion object {
        const val APP_SCHEME = "androidapp://"
    }
}
