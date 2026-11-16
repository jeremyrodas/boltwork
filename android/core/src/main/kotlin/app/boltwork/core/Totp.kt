package app.boltwork.core

import java.net.URI
import java.net.URLDecoder
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/** Time-based one-time passwords (RFC 6238), from a base32 secret or an `otpauth://` link. */
class Totp(input: String) {
    enum class Algorithm(val mac: String) { SHA1("HmacSHA1"), SHA256("HmacSHA256"), SHA512("HmacSHA512") }

    class ParseError(message: String) : Exception(message)

    val secret: ByteArray
    var algorithm = Algorithm.SHA1
        private set
    var digits = 6
        private set
    var period = 30
        private set
    var issuer: String? = null
        private set
    var account: String? = null
        private set

    init {
        val v = input.trim()
        if (!v.lowercase().startsWith("otpauth://")) {
            secret = base32Decode(v)
        } else {
            val uri = try { URI(v.replace(" ", "%20")) } catch (_: Exception) { throw ParseError(NOT_TOTP) }
            if (uri.host?.lowercase() != "totp") throw ParseError(NOT_TOTP)
            val q = HashMap<String, String>()
            for (pair in (uri.rawQuery ?: "").split("&")) {
                if (pair.isEmpty()) continue
                val name = decode(pair.substringBefore("=")).lowercase()
                if (name !in q) q[name] = decode(pair.substringAfter("=", ""))
            }
            val alg = (q["algorithm"] ?: "SHA1").uppercase()
            algorithm = Algorithm.entries.firstOrNull { it.name == alg } ?: throw ParseError("Unsupported algorithm $alg.")
            secret = base32Decode(q["secret"] ?: "")
            digits = q["digits"]?.toIntOrNull() ?: 6
            period = q["period"]?.toIntOrNull()?.takeIf { it > 0 } ?: 30
            val label = (uri.path ?: "").removePrefix("/")
            val parts = label.split(":", limit = 2)
            issuer = q["issuer"] ?: if (parts.size == 2) parts[0] else null
            account = (if (parts.size == 2) parts[1] else label).trim()
        }
    }

    fun code(atMillis: Long): String {
        val counter = Math.floorDiv(atMillis / 1000, period.toLong())
        val message = ByteArray(8) { (counter ushr (56 - 8 * it)).toByte() }
        val hmac = Mac.getInstance(algorithm.mac)
        hmac.init(SecretKeySpec(secret, algorithm.mac))
        val mac = hmac.doFinal(message)
        val offset = mac.last().toInt() and 15
        val bin = ((mac[offset].toInt() and 127) shl 24) or ((mac[offset + 1].toInt() and 255) shl 16) or
            ((mac[offset + 2].toInt() and 255) shl 8) or (mac[offset + 3].toInt() and 255)
        var modulus = 1L
        repeat(minOf(digits, 9)) { modulus *= 10 }
        return (bin % modulus).toString().padStart(digits, '0')
    }

    /** Seconds until the code changes. */
    fun remaining(atMillis: Long): Int = period - ((atMillis / 1000) % period).toInt()

    companion object {
        private const val NOT_TOTP = "Only time-based (TOTP) codes are supported."
        private const val ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"

        private fun decode(s: String) = URLDecoder.decode(s, "UTF-8")

        fun base32Decode(input: String): ByteArray {
            val s = input.uppercase().filter { it !in " \t\n=-" }
            if (s.isEmpty()) throw ParseError("The one-time password secret is not valid base32.")
            var bits = 0
            var value = 0
            val out = ArrayList<Byte>()
            for (c in s) {
                val i = ALPHABET.indexOf(c)
                if (i < 0) throw ParseError("The one-time password secret is not valid base32.")
                value = (value shl 5) or i
                bits += 5
                if (bits >= 8) {
                    out.add(((value shr (bits - 8)) and 255).toByte())
                    bits -= 8
                }
                value = value and ((1 shl bits) - 1)
            }
            return out.toByteArray()
        }
    }
}
