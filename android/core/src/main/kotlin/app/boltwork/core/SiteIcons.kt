package app.boltwork.core

import java.net.URI

/**
 * Website logos, the parts that are plain text handling: which page to read a site's icon links from, which of
 * those icons to try first, and which website a well-known service's name means. Matches the desktop app
 * (src/core/siteIcon.ts and src/core/knownSites.ts) so items look the same on every device. Fetching and
 * drawing happen in the Android app (SiteIconFetcher.kt).
 */
object SiteIcons {
    /** The size, in pixels, of the PNG a logo is saved as. */
    const val SIZE = 64
    /** Saved logos are PNG data URLs no bigger than this. */
    const val MAX_ICON_CHARS = 64 * 1024

    /** The host whose logo an item shows: its first website's, without "www.". Empty when it has none. */
    fun hostOf(content: ItemContent): String = content.urls.firstOrNull()?.url?.trim()?.takeIf { it.isNotEmpty() }?.let(Domain::host) ?: ""

    /** True when the item's icon is one the user chose, which is never replaced automatically. */
    fun isCustom(content: ItemContent): Boolean = content.icon != null && content.iconHost == null

    /** The page to read a site's icon links from: its homepage, over https unless the address says http. */
    fun siteHome(url: String): URI? {
        val raw = url.trim()
        if (raw.isEmpty()) return null
        return runCatching {
            val u = URI(if (Regex("^[a-z][a-z0-9+.-]*://", RegexOption.IGNORE_CASE).containsMatchIn(raw)) raw else "https://$raw")
            val scheme = u.scheme?.lowercase()
            val host = u.host ?: return null
            if (scheme != "https" && scheme != "http") return null
            if (!host.contains('.') && host != "localhost") return null
            URI(scheme, null, host, u.port, "/", null, null)
        }.getOrNull()
    }

    private fun attr(tag: String, name: String): String? {
        val m = Regex("\\s$name\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))", RegexOption.IGNORE_CASE).find(tag) ?: return null
        return m.groupValues.drop(1).firstOrNull { it.isNotEmpty() } ?: ""
    }

    private fun decodeEntities(s: String) = s.replace("&amp;", "&").replace("&quot;", "\"").replace("&#39;", "'")
        .replace("&apos;", "'").replace("&lt;", "<").replace("&gt;", ">")

    private fun resolve(base: String, href: String): String? = runCatching { URI(base).resolve(URI(href.replace(" ", "%20"))).toString() }.getOrNull()

    /**
     * The icons a page links to, best first: scalable icons, large touch icons, then sized icons by size, then any
     * other icon, then /favicon.ico. Monochrome mask icons are skipped; they're drawn in a single color.
     */
    fun iconCandidates(html: String, pageUrl: String): List<String> {
        val head = html.take(256 * 1024)
        var base = pageUrl
        Regex("<base\\s[^>]*>", RegexOption.IGNORE_CASE).find(head)?.value?.let { attr(it, "href") }?.takeIf { it.isNotEmpty() }?.let { href ->
            resolve(pageUrl, decodeEntities(href))?.let { base = it }
        }
        data class Found(val url: String, val score: Double)
        val found = mutableListOf<Found>()
        for (m in Regex("<link\\s[^>]*>", RegexOption.IGNORE_CASE).findAll(head)) {
            val tag = m.value
            val rel = (attr(tag, "rel") ?: "").lowercase().split(Regex("\\s+"))
            val href = attr(tag, "href")
            if (href.isNullOrEmpty() || "mask-icon" in rel) continue
            val touch = rel.any { it.startsWith("apple-touch-icon") }
            if (!touch && "icon" !in rel) continue
            val url = resolve(base, decodeEntities(href.trim())) ?: continue
            if (!Regex("^(https?:|data:image/)", RegexOption.IGNORE_CASE).containsMatchIn(url)) continue
            val sizes = (attr(tag, "sizes") ?: "").lowercase()
            val svg = sizes == "any" || Regex("svg", RegexOption.IGNORE_CASE).containsMatchIn(attr(tag, "type") ?: "") ||
                Regex("\\.svg(\\?|#|$)", RegexOption.IGNORE_CASE).containsMatchIn(url)
            val px = Regex("(\\d+)x\\d+").findAll(sizes).maxOfOrNull { it.groupValues[1].toInt() } ?: 0
            // Big enough to look sharp at 64 px is what matters; past that, size adds nothing.
            val score = when {
                svg -> 900.0
                touch -> 800 + minOf(if (px > 0) px else 180, 512) / 10.0
                px > 0 -> minOf(px, 512).toDouble()
                else -> 100.0
            }
            found += Found(url, score)
        }
        val ordered = found.sortedByDescending { it.score }.map { it.url }.toMutableList()
        resolve(pageUrl, "/favicon.ico")?.let { ordered += it }
        return ordered.distinct()
    }

    // Common services by name, so a login titled "Netflix" gets netflix.com as its website (and so its logo).
    // Only names that clearly mean one site. Generated from the desktop app's list; keep the two the same.
    private val SITES = mapOf(
        "amazon" to "amazon.com", "ebay" to "ebay.com", "etsy" to "etsy.com", "walmart" to "walmart.com", "target" to "target.com",
        "costco" to "costco.com", "best buy" to "bestbuy.com", "bestbuy" to "bestbuy.com", "ikea" to "ikea.com", "wayfair" to "wayfair.com",
        "aliexpress" to "aliexpress.com", "temu" to "temu.com", "shein" to "shein.com", "home depot" to "homedepot.com",
        "lowes" to "lowes.com", "lowe's" to "lowes.com", "newegg" to "newegg.com", "chewy" to "chewy.com", "instacart" to "instacart.com",
        "shopify" to "shopify.com", "facebook marketplace" to "facebook.com", "netflix" to "netflix.com", "hulu" to "hulu.com",
        "disney+" to "disneyplus.com", "disney plus" to "disneyplus.com", "disneyplus" to "disneyplus.com", "hbo max" to "max.com",
        "prime video" to "primevideo.com", "paramount+" to "paramountplus.com", "paramount plus" to "paramountplus.com",
        "peacock" to "peacocktv.com", "crunchyroll" to "crunchyroll.com", "youtube" to "youtube.com", "youtube tv" to "tv.youtube.com",
        "twitch" to "twitch.tv", "spotify" to "spotify.com", "pandora" to "pandora.com", "tidal" to "tidal.com", "deezer" to "deezer.com",
        "soundcloud" to "soundcloud.com", "audible" to "audible.com", "plex" to "plex.tv", "sling tv" to "sling.com", "sling" to "sling.com",
        "fubo" to "fubo.tv", "fubotv" to "fubo.tv", "apple tv+" to "tv.apple.com", "steam" to "steampowered.com", "epic games" to "epicgames.com",
        "epic games store" to "epicgames.com", "xbox" to "xbox.com", "playstation" to "playstation.com", "playstation network" to "playstation.com",
        "psn" to "playstation.com", "nintendo" to "nintendo.com", "nintendo account" to "nintendo.com", "battle.net" to "battle.net",
        "blizzard" to "battle.net", "ea app" to "ea.com", "ea" to "ea.com", "origin" to "ea.com", "ubisoft" to "ubisoft.com",
        "ubisoft connect" to "ubisoft.com", "gog" to "gog.com", "gog.com" to "gog.com", "roblox" to "roblox.com", "minecraft" to "minecraft.net",
        "riot games" to "riotgames.com", "facebook" to "facebook.com", "instagram" to "instagram.com", "twitter" to "x.com",
        "x" to "x.com", "threads" to "threads.net", "tiktok" to "tiktok.com", "snapchat" to "snapchat.com", "reddit" to "reddit.com",
        "linkedin" to "linkedin.com", "pinterest" to "pinterest.com", "tumblr" to "tumblr.com", "discord" to "discord.com",
        "whatsapp" to "whatsapp.com", "telegram" to "telegram.org", "signal" to "signal.org", "bluesky" to "bsky.app", "mastodon" to "joinmastodon.org",
        "quora" to "quora.com", "nextdoor" to "nextdoor.com", "stack overflow" to "stackoverflow.com", "stackoverflow" to "stackoverflow.com",
        "google" to "google.com", "google account" to "google.com", "gmail" to "gmail.com", "outlook" to "outlook.com", "hotmail" to "outlook.com",
        "microsoft" to "microsoft.com", "microsoft account" to "microsoft.com", "microsoft 365" to "microsoft365.com", "office 365" to "microsoft365.com",
        "yahoo" to "yahoo.com", "yahoo mail" to "yahoo.com", "proton mail" to "proton.me", "protonmail" to "proton.me", "proton" to "proton.me",
        "icloud" to "icloud.com", "apple id" to "apple.com", "apple account" to "apple.com", "aol" to "aol.com", "fastmail" to "fastmail.com",
        "zoho" to "zoho.com", "dropbox" to "dropbox.com", "box" to "box.com", "google drive" to "drive.google.com", "onedrive" to "onedrive.live.com",
        "mega" to "mega.io", "backblaze" to "backblaze.com", "adobe" to "adobe.com", "adobe account" to "adobe.com", "canva" to "canva.com",
        "notion" to "notion.so", "evernote" to "evernote.com", "todoist" to "todoist.com", "trello" to "trello.com", "github" to "github.com",
        "gitlab" to "gitlab.com", "bitbucket" to "bitbucket.org", "slack" to "slack.com", "zoom" to "zoom.us", "microsoft teams" to "teams.microsoft.com",
        "teams" to "teams.microsoft.com", "atlassian" to "atlassian.com", "jira" to "atlassian.com", "confluence" to "atlassian.com",
        "asana" to "asana.com", "figma" to "figma.com", "docker" to "docker.com", "docker hub" to "hub.docker.com", "npm" to "npmjs.com",
        "aws" to "aws.amazon.com", "amazon web services" to "aws.amazon.com", "azure" to "azure.microsoft.com", "google cloud" to "cloud.google.com",
        "cloudflare" to "cloudflare.com", "digitalocean" to "digitalocean.com", "heroku" to "heroku.com", "vercel" to "vercel.com",
        "netlify" to "netlify.com", "openai" to "openai.com", "chatgpt" to "chatgpt.com", "claude" to "claude.ai", "anthropic" to "anthropic.com",
        "salesforce" to "salesforce.com", "hubspot" to "hubspot.com", "mailchimp" to "mailchimp.com", "godaddy" to "godaddy.com",
        "namecheap" to "namecheap.com", "squarespace" to "squarespace.com", "wix" to "wix.com", "wordpress" to "wordpress.com",
        "tailscale" to "tailscale.com", "paypal" to "paypal.com", "venmo" to "venmo.com", "cash app" to "cash.app", "cashapp" to "cash.app",
        "zelle" to "zellepay.com", "stripe" to "stripe.com", "chase" to "chase.com", "bank of america" to "bankofamerica.com",
        "wells fargo" to "wellsfargo.com", "citi" to "citi.com", "citibank" to "citi.com", "capital one" to "capitalone.com",
        "american express" to "americanexpress.com", "amex" to "americanexpress.com", "discover" to "discover.com", "us bank" to "usbank.com",
        "u.s. bank" to "usbank.com", "pnc" to "pnc.com", "truist" to "truist.com", "usaa" to "usaa.com", "navy federal" to "navyfederal.org",
        "ally" to "ally.com", "ally bank" to "ally.com", "schwab" to "schwab.com", "charles schwab" to "schwab.com", "fidelity" to "fidelity.com",
        "vanguard" to "vanguard.com", "robinhood" to "robinhood.com", "e*trade" to "etrade.com", "etrade" to "etrade.com",
        "coinbase" to "coinbase.com", "kraken" to "kraken.com", "sofi" to "sofi.com", "chime" to "chime.com", "wise" to "wise.com",
        "revolut" to "revolut.com", "credit karma" to "creditkarma.com", "experian" to "experian.com", "equifax" to "equifax.com",
        "transunion" to "transunion.com", "intuit" to "intuit.com", "turbotax" to "turbotax.intuit.com", "quickbooks" to "quickbooks.intuit.com",
        "mint" to "mint.intuit.com", "airbnb" to "airbnb.com", "booking.com" to "booking.com", "booking" to "booking.com",
        "expedia" to "expedia.com", "hotels.com" to "hotels.com", "vrbo" to "vrbo.com", "kayak" to "kayak.com", "tripadvisor" to "tripadvisor.com",
        "uber" to "uber.com", "uber eats" to "ubereats.com", "lyft" to "lyft.com", "doordash" to "doordash.com", "grubhub" to "grubhub.com",
        "delta" to "delta.com", "delta air lines" to "delta.com", "american airlines" to "aa.com", "united" to "united.com",
        "united airlines" to "united.com", "southwest" to "southwest.com", "southwest airlines" to "southwest.com", "jetblue" to "jetblue.com",
        "alaska" to "alaskaair.com", "alaska airlines" to "alaskaair.com", "marriott" to "marriott.com", "marriott bonvoy" to "marriott.com",
        "hilton" to "hilton.com", "hilton honors" to "hilton.com", "hyatt" to "hyatt.com", "ihg" to "ihg.com", "verizon" to "verizon.com",
        "at&t" to "att.com", "att" to "att.com", "t-mobile" to "t-mobile.com", "tmobile" to "t-mobile.com", "xfinity" to "xfinity.com",
        "comcast" to "xfinity.com", "spectrum" to "spectrum.net", "google fi" to "fi.google.com", "mint_mobile" to "mintmobile.com",
        "mint mobile" to "mintmobile.com", "visible" to "visible.com", "cox" to "cox.com", "optimum" to "optimum.net", "state farm" to "statefarm.com",
        "geico" to "geico.com", "progressive" to "progressive.com", "allstate" to "allstate.com", "kaiser permanente" to "kp.org",
        "duolingo" to "duolingo.com", "coursera" to "coursera.org", "udemy" to "udemy.com", "khan_academy" to "khanacademy.org",
        "khan academy" to "khanacademy.org", "goodreads" to "goodreads.com", "kindle" to "amazon.com", "patreon" to "patreon.com",
        "ring" to "ring.com", "nest" to "home.nest.com", "google nest" to "home.nest.com", "ancestry" to "ancestry.com",
        "23andme" to "23andme.com", "strava" to "strava.com", "fitbit" to "fitbit.com", "peloton" to "onepeloton.com", "myfitnesspal" to "myfitnesspal.com",
        "ticketmaster" to "ticketmaster.com", "stubhub" to "stubhub.com", "eventbrite" to "eventbrite.com", "yelp" to "yelp.com",
        "zillow" to "zillow.com", "redfin" to "redfin.com", "craigslist" to "craigslist.org", "indeed" to "indeed.com", "glassdoor" to "glassdoor.com",
        "1password" to "1password.com", "bitwarden" to "bitwarden.com", "lastpass" to "lastpass.com", "dashlane" to "dashlane.com",
        "nordvpn" to "nordvpn.com", "expressvpn" to "expressvpn.com", "mullvad" to "mullvad.net", "proton vpn" to "protonvpn.com",
        "protonvpn" to "protonvpn.com", "wikipedia" to "wikipedia.org", "the new york times" to "nytimes.com", "new york times" to "nytimes.com",
        "nytimes" to "nytimes.com", "washington post" to "washingtonpost.com", "medium" to "medium.com", "substack" to "substack.com",
        "usps" to "usps.com", "ups" to "ups.com", "fedex" to "fedex.com", "irs" to "irs.gov", "social security" to "ssa.gov",
        "ssa" to "ssa.gov",
    )

    private fun norm(s: String) = s.lowercase().replace('’', '\'').replace(Regex("\\s+"), " ").trim()
    private val INDEX = SITES.entries.associate { (k, v) -> norm(k.replace('_', ' ')) to v }

    /**
     * The website for a title like "Netflix" or "Chase (checking)": the known name, ignoring case, anything in
     * brackets and a trailing "account" or "login". Null when the title isn't a known service.
     */
    fun websiteForName(title: String): String? {
        var t = norm(title).replace(Regex("\\s*[(\\[].*$"), "").replace(Regex("\\s*[-–—:|]\\s.*$"), "").trim()
        INDEX[t]?.let { return it }
        t = t.replace(Regex("\\s+(account|login|sign[- ]?in|personal|work|business)$"), "").trim()
        return INDEX[t]
    }
}
