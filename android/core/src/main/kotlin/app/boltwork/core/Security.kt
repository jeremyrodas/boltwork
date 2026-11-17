package app.boltwork.core

import java.net.HttpURLConnection
import java.net.URI
import java.security.MessageDigest
import java.time.LocalDate
import java.time.ZoneOffset
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/** Host names from item URLs, for matching and Watchtower. */
object Domain {
    fun host(url: String): String {
        val trimmed = url.trim()
        val withScheme = if (trimmed.contains("://")) trimmed else "https://$trimmed"
        val host = runCatching { URI(withScheme).host }.getOrNull() ?: return ""
        return host.lowercase().removePrefix("www.")
    }

    private val twoPartSuffixes = setOf("co.uk", "org.uk", "ac.uk", "gov.uk", "com.au", "net.au", "co.nz", "co.jp", "com.br", "co.in", "co.za", "com.mx")

    /** The registrable part of a host, approximately ("mail.google.com" → "google.com", "bbc.co.uk" → "bbc.co.uk"). */
    fun base(host: String): String {
        val parts = host.split('.').filter { it.isNotEmpty() }
        if (parts.size <= 2) return host
        val lastTwo = parts.takeLast(2).joinToString(".")
        return (if (lastTwo in twoPartSuffixes) parts.takeLast(3) else parts.takeLast(2)).joinToString(".")
    }

    /** A URL that opens in a browser, adding https:// if the item left it out. */
    fun openable(url: String): String? {
        val t = url.trim()
        if (t.isEmpty()) return null
        return if (t.contains("://")) t else "https://$t"
    }
}

/**
 * A password strength estimate on the desktop app's 0–7 scale, the same lighter estimate as the Apple apps:
 * the character pool and length, discounting repeats, sequences, keyboard runs and common passwords and words.
 */
class PasswordStrength(password: String) {
    val level: Int
    val guessesLog10: Double
    val label: String get() = LABELS[level]
    /** Watchtower treats Terrible, Weak and Fair as weak. */
    val isWeak: Boolean get() = level <= 3

    init {
        if (password.isEmpty()) {
            level = 0; guessesLog10 = 0.0
        } else {
            val g = estimateGuessesLog10(password.take(200))
            guessesLog10 = (g * 10).roundToInt() / 10.0
            level = (THRESHOLDS.indexOfFirst { g < it }.takeIf { it >= 0 } ?: 6) + 1
        }
    }

    companion object {
        val LABELS = listOf("None", "Terrible", "Weak", "Fair", "Good", "Very Good", "Excellent", "Fantastic")
        private val THRESHOLDS = listOf(4.0, 6.0, 8.0, 10.0, 12.0, 14.0)
        private val common = setOf(
            "password", "123456", "12345678", "qwerty", "abc123", "monkey", "letmein", "dragon", "111111", "baseball",
            "iloveyou", "trustno1", "sunshine", "master", "welcome", "shadow", "ashley", "football", "jesus", "michael",
            "ninja", "mustang", "password1", "admin", "login", "princess", "starwars", "hello", "freedom", "whatever",
            "qazwsx", "superman", "batman", "secret", "hunter", "hunter2", "changeme", "passw0rd", "p@ssword", "summer", "winter",
        )
        private val keyboardRows = listOf("qwertyuiop", "asdfghjkl", "zxcvbnm", "1234567890", "!@#$%^&*()")
        private val wordSet by lazy { PasswordGenerator.words.toHashSet() }

        internal fun estimateGuessesLog10(pw: String): Double {
            val lowered = pw.lowercase()
            if (lowered in common || lowered.trim { it.isDigit() } in common) return 1.0

            var pool = 0
            if (pw.any { it.isLowerCase() }) pool += 26
            if (pw.any { it.isUpperCase() }) pool += 26
            if (pw.any { it.isDigit() }) pool += 10
            if (pw.any { !it.isLetter() && !it.isDigit() && it.code < 128 }) pool += 33
            if (pw.any { it.code >= 128 }) pool += 100

            // Runs, sequences and keyboard walks add little.
            var effective = 0.0
            for (i in lowered.indices) {
                if (i == 0) { effective += 1; continue }
                val a = lowered[i - 1]; val b = lowered[i]
                val sequential = a.code < 128 && b.code < 128 && abs(a.code - b.code) == 1
                val keyboard = keyboardRows.any { it.contains("$a$b") || it.contains("$b$a") }
                effective += if (a == b || sequential || keyboard) 0.2 else 1.0
            }

            // Words from the wordlist count as one symbol from a 7776-word pool rather than many letters.
            val poolLog = log10(max(pool, 10).toDouble())
            var result = effective * poolLog
            val hits = lowered.split(Regex("[^\\p{L}]+")).filter { it.length >= 3 && it in wordSet }
            if (hits.isNotEmpty()) {
                val rest = max(0.0, effective - hits.sumOf { it.length })
                result = min(result, hits.size * log10(7776.0) + rest * poolLog + 0.5)
            }
            return max(0.0, result - 0.3)
        }
    }
}

@Suppress("EnumEntryName")
enum class WatchtowerCheck(internal val weight: Double, val title: String) {
    compromisedWebsite(5.0, "Compromised websites"),
    vulnerable(5.0, "Vulnerable passwords"),
    weak(3.0, "Weak passwords"),
    reused(3.0, "Reused passwords"),
    unsecured(1.0, "Unsecured websites"),
    inactive2fa(1.0, "Two-factor authentication"),
    expiring(1.0, "Expiring"),
    duplicate(0.5, "Duplicates"),
}

data class WatchtowerIssue(val check: WatchtowerCheck, val itemId: String, val detail: String)

class WatchtowerReport(val score: Int, val issues: List<WatchtowerIssue>) {
    val scoreLabel: String
        get() = when {
            score > 900 -> "Excellent"; score > 800 -> "Very Good"; score > 600 -> "Good"; score > 400 -> "Fair"; else -> "Poor"
        }
    fun count(check: WatchtowerCheck) = issues.count { it.check == check }
}

/** The security report, computed on this device, as in the other apps. Breach checks are optional and use k-anonymity. */
object Watchtower {
    fun run(items: List<Item>, pwnedCounts: Map<String, Int> = emptyMap(), now: Long = System.currentTimeMillis()): WatchtowerReport {
        val active = items.filter { it.state == ItemState.active }
        val issues = mutableListOf<WatchtowerIssue>()
        fun add(item: Item, check: WatchtowerCheck, detail: String) {
            if (check.name !in item.watchtowerIgnore) issues += WatchtowerIssue(check, item.id, detail)
        }

        val byPassword = LinkedHashMap<String, MutableList<Item>>()
        for (item in active) {
            val pw = item.content.field(FieldPurpose.password)?.value ?: continue
            byPassword.getOrPut(pw) { mutableListOf() } += item
            if (PasswordStrength(pw).isWeak) add(item, WatchtowerCheck.weak, "This password is easy to guess.")
        }
        for ((pw, list) in byPassword) {
            if (list.size > 1) {
                val others = list.size - 1
                list.forEach { add(it, WatchtowerCheck.reused, "This password is also used by $others other item${if (others > 1) "s" else ""}.") }
            }
            val n = pwnedCounts[sha1Hex(pw)] ?: 0
            if (n > 0) list.forEach { add(it, WatchtowerCheck.vulnerable, "This password has appeared in ${"%,d".format(n)} data breaches.") }
        }

        for (item in active) {
            if (item.content.urls.any { it.url.lowercase().startsWith("http://") && !isPrivateHost(Domain.host(it.url)) }) {
                add(item, WatchtowerCheck.unsecured, "This website address uses HTTP, which is not encrypted.")
            }
        }

        for (item in active) {
            val exp = item.content.allFields.firstOrNull { it.purpose == FieldPurpose.expiry && it.value.isNotEmpty() } ?: continue
            val t = parseExpiry(exp.value) ?: continue
            if (t >= now + 30 * 86_400_000.0) continue
            add(item, WatchtowerCheck.expiring, if (t < now) "This item has expired." else "This item expires in ${ceil((t - now) / 86_400_000).toInt()} days.")
        }

        val seen = HashMap<String, Item>()
        for (item in active) {
            val user = item.content.field(FieldPurpose.username)?.value?.lowercase() ?: continue
            val first = item.content.urls.firstOrNull() ?: continue
            val host = Domain.base(Domain.host(first.url))
            if (host.isEmpty()) continue
            val k = "${item.category.name}|$host|$user"
            val original = seen[k]
            if (original != null) add(item, WatchtowerCheck.duplicate, "This looks like a duplicate of “${original.title}”.") else seen[k] = item
        }

        val scorable = max(1, active.count { it.content.field(FieldPurpose.password) != null }).toDouble()
        val penalty = issues.sumOf { it.check.weight }
        val score = max(0, (1000 * (1 - penalty / (scorable * 8))).roundToInt())
        return WatchtowerReport(score, issues)
    }

    fun sha1Hex(s: String): String =
        MessageDigest.getInstance("SHA-1").digest(s.toByteArray()).joinToString("") { "%02X".format(it) }

    /** How many breaches a password appeared in, sending only the first 5 characters of its SHA-1. Blocking. */
    fun pwnedCount(sha1: String): Int {
        val prefix = sha1.take(5); val suffix = sha1.drop(5)
        val connection = URI("https://api.pwnedpasswords.com/range/$prefix").toURL().openConnection() as HttpURLConnection
        connection.setRequestProperty("Add-Padding", "true")
        connection.connectTimeout = 15_000; connection.readTimeout = 15_000
        try {
            if (connection.responseCode != 200) throw java.io.IOException("Breach check failed (${connection.responseCode}).")
            connection.inputStream.bufferedReader().useLines { lines ->
                for (line in lines) {
                    val parts = line.split(':')
                    if (parts.size == 2 && parts[0] == suffix) return parts[1].trim().toIntOrNull() ?: 0
                }
            }
            return 0
        } finally {
            connection.disconnect()
        }
    }

    internal fun isPrivateHost(host: String) =
        host == "localhost" || host.endsWith(".local") || host.endsWith(".lan") || host.startsWith("10.") || host.startsWith("127.") ||
            host.startsWith("192.168.") || Regex("""172\.(1[6-9]|2\d|3[01])\..*""").matches(host)

    /** Expiry formats: YYYY-MM-DD, YYYY-MM, MM/YY, MM/YYYY. Returns the last millisecond (UTC) of that day or month. */
    fun parseExpiry(value: String): Double? {
        val s = value.trim()
        fun ms(y: Int, m: Int, d: Int): Double? = runCatching {
            // Like Foundation's calendar, let day and month overflow into the next month or year.
            LocalDate.of(y, 1, 1).plusMonths((m - 1).toLong()).plusDays((d - 1).toLong()).atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli() - 1.0
        }.getOrNull()
        Regex("""(\d{4})-(\d{1,2})-(\d{1,2})""").matchEntire(s)?.let { val (y, m, d) = it.destructured; return ms(y.toInt(), m.toInt(), d.toInt() + 1) }
        Regex("""(\d{4})-(\d{1,2})""").matchEntire(s)?.let { val (y, m) = it.destructured; return ms(y.toInt(), m.toInt() + 1, 1) }
        Regex("""(\d{1,2})\s*/\s*(\d{2}|\d{4})""").matchEntire(s)?.let {
            val (m, yy) = it.destructured
            return ms(if (yy.length == 2) 2000 + yy.toInt() else yy.toInt(), m.toInt() + 1, 1)
        }
        return null
    }
}
