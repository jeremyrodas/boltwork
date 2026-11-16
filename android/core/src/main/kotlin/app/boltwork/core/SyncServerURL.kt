package app.boltwork.core

import java.net.URI

/** Checks and tidies a sync server address. Plain http is only allowed on this device or a private network. */
object SyncServerURL {
    class Invalid(message: String) : Exception(message)

    private val privateV4 = Regex("""^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)\d""")

    fun isLocalNetworkHost(host: String): Boolean {
        val h = host.lowercase().removePrefix("[").removeSuffix("]")
        if (h == "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".home.arpa")) return true
        if (h == "::1") return true
        if (Regex("^f[cd][0-9a-f]{2}:").containsMatchIn(h) || Regex("^fe[89ab][0-9a-f]:").containsMatchIn(h)) return true
        return privateV4.containsMatchIn(h) && h.all { it.isDigit() || it == '.' }
    }

    fun normalize(input: String): String {
        var text = input.trim().trimEnd('/')
        if (text.isEmpty()) throw Invalid("Enter the server address.")
        if (!text.contains("://")) {
            val host = if (text.startsWith("[")) text.substringBefore("]") + "]" else text.substringBefore("/").substringBefore(":")
            text = (if (isLocalNetworkHost(host)) "http://" else "https://") + text
        }
        val uri = try { URI(text) } catch (_: Exception) { throw Invalid(NOT_VALID) }
        val scheme = uri.scheme?.lowercase()
        val host = uri.host
        if ((scheme != "http" && scheme != "https") || host.isNullOrEmpty()) throw Invalid(NOT_VALID)
        if (scheme == "http" && !isLocalNetworkHost(host)) {
            throw Invalid("Use an https:// address. Plain http is only allowed for this device or a private network address, such as your home network or a VPN (like 192.168.1.20).")
        }
        val bare = host.removePrefix("[").removeSuffix("]")
        val shown = if (bare.contains(":")) "[$bare]" else bare.lowercase()
        val port = if (uri.port >= 0) ":${uri.port}" else ""
        return "$scheme://$shown$port${(uri.rawPath ?: "").trimEnd('/')}"
    }

    private const val NOT_VALID = "That server address isn’t valid."
}
