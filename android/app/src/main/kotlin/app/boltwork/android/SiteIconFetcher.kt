package app.boltwork.android

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.util.Base64
import app.boltwork.core.SiteIcons
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL

/**
 * Fetches a website's logo from the website itself, so no icon service learns which sites are in the vault, and
 * turns it into the 64 px PNG that's saved on the item. Same steps as the desktop app (src/main/siteIcon.ts and
 * src/renderer/siteIcon.ts), so a logo looks the same whichever device fetched it.
 */
object SiteIconFetcher {
    private const val PAGE_LIMIT = 1024 * 1024
    private const val ICON_LIMIT = 512 * 1024
    private const val TIMEOUT_MS = 8000
    private const val SIZE = SiteIcons.SIZE

    /** The logo for a website address as a PNG data URL, or null if the site has none that can be read. */
    suspend fun iconFor(url: String): String? = withContext(Dispatchers.IO) {
        runCatching { fetch(url) }.getOrNull()
    }

    private class Response(val url: String, val type: String, val body: ByteArray?)

    /** A GET with no cookies, following up to 5 redirects (including http → https), reading at most `limit` bytes. */
    private fun get(start: String, accept: String, limit: Int): Response? {
        var url = start
        repeat(6) {
            val conn = (URL(url).openConnection() as? HttpURLConnection) ?: return null
            try {
                conn.instanceFollowRedirects = false
                conn.connectTimeout = TIMEOUT_MS
                conn.readTimeout = TIMEOUT_MS
                conn.useCaches = false
                conn.setRequestProperty("Accept", accept)
                conn.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android) Boltwork")
                val code = conn.responseCode
                if (code in 300..399) {
                    url = URL(URL(url), conn.getHeaderField("Location") ?: return null).toString()
                    return@repeat
                }
                if (code !in 200..299) return null
                if (conn.contentLengthLong > limit) return null
                return Response(url, conn.contentType.orEmpty(), conn.inputStream.use { readLimited(it, limit) })
            } finally {
                conn.disconnect()
            }
        }
        return null
    }

    private fun readLimited(input: InputStream, limit: Int): ByteArray? {
        val out = ByteArrayOutputStream()
        val buf = ByteArray(16 * 1024)
        while (true) {
            val n = input.read(buf)
            if (n < 0) break
            out.write(buf, 0, n)
            if (out.size() > limit) return null
        }
        return out.toByteArray()
    }

    private fun fetch(url: String): String? {
        val home = SiteIcons.siteHome(url) ?: return null
        var candidates = listOf(home.resolve("/favicon.ico").toString())
        runCatching {
            val page = get(home.toString(), "text/html,application/xhtml+xml", PAGE_LIMIT)
            if (page?.body != null && (page.type.isEmpty() || page.type.contains("html", ignoreCase = true))) {
                // After redirects (example.com → www.example.com), links resolve against the page actually served.
                candidates = SiteIcons.iconCandidates(String(page.body, Charsets.UTF_8), page.url)
            }
        }
        for (candidate in candidates.take(6)) {
            val bytes = if (candidate.startsWith("data:")) fromDataUrl(candidate)
                else runCatching { get(candidate, "image/*", ICON_LIMIT)?.body }.getOrNull()
            // Android can't draw SVG logos; those sites usually also offer a PNG or favicon further down the list.
            val bitmap = bytes?.takeIf { it.isNotEmpty() }?.let { BitmapFactory.decodeByteArray(it, 0, it.size) } ?: continue
            return render(bitmap)
        }
        return null
    }

    private fun fromDataUrl(url: String): ByteArray? {
        val m = Regex("^data:(image/[a-z0-9.+-]+)(;base64)?,(.*)$", setOf(RegexOption.IGNORE_CASE, RegexOption.DOT_MATCHES_ALL)).find(url) ?: return null
        val bytes = runCatching {
            if (m.groupValues[2].isNotEmpty()) Base64.decode(m.groupValues[3], Base64.DEFAULT)
            else java.net.URLDecoder.decode(m.groupValues[3], "UTF-8").toByteArray()
        }.getOrNull() ?: return null
        return bytes.takeIf { it.size <= ICON_LIMIT }
    }

    /** Scales the logo onto a 64 px square, on a white tile if it has see-through parts, as a PNG data URL. */
    private fun render(source: Bitmap): String? {
        var img = source
        if (img.width < 8 || img.height < 8) return null
        // Halve big logos step by step first; one big jump down to 64 px looks jagged.
        while (maxOf(img.width, img.height) > SIZE * 2) {
            img = Bitmap.createScaledBitmap(img, maxOf(1, img.width / 2), maxOf(1, img.height / 2), true)
        }
        val out = Bitmap.createBitmap(SIZE, SIZE, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(out)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
        fun draw(box: Float) {
            val scale = box / maxOf(img.width, img.height)
            val w = img.width * scale
            val h = img.height * scale
            canvas.drawBitmap(img, null, RectF((SIZE - w) / 2, (SIZE - h) / 2, (SIZE + w) / 2, (SIZE + h) / 2), paint)
        }
        draw(SIZE.toFloat())
        val px = IntArray(SIZE * SIZE)
        out.getPixels(px, 0, SIZE, 0, 0, SIZE, SIZE)
        val opaque = px.count { (it ushr 24) > 16 }
        // A blank image (fully transparent) is no logo.
        if (opaque == 0) return null
        // A logo with see-through parts (GitHub's black cat) could vanish on a dark theme, so it goes on a white
        // tile, inset a little, the way logos sit on app icons. Logos that fill their square keep their background.
        if (opaque < SIZE * SIZE * 0.9) {
            canvas.drawColor(Color.WHITE, android.graphics.PorterDuff.Mode.SRC)
            draw(SIZE * 0.72f)
        }
        val png = ByteArrayOutputStream().also { out.compress(Bitmap.CompressFormat.PNG, 100, it) }.toByteArray()
        val dataUrl = "data:image/png;base64," + Base64.encodeToString(png, Base64.NO_WRAP)
        return dataUrl.takeIf { it.length <= SiteIcons.MAX_ICON_CHARS }
    }

    /** Decodes a saved icon (a PNG data URL, or any image data URL a user picked) for drawing. */
    fun decode(icon: String): Bitmap? {
        val comma = icon.indexOf(',')
        if (!icon.startsWith("data:image/") || comma < 0 || !icon.substring(0, comma).endsWith(";base64")) return null
        return runCatching {
            val bytes = Base64.decode(icon.substring(comma + 1), Base64.DEFAULT)
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
        }.getOrNull()
    }
}
