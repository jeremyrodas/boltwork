package app.boltwork.core

import org.bouncycastle.crypto.params.Ed25519PrivateKeyParameters
import java.math.BigInteger
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64

/**
 * An SSH private key as Boltwork keeps it on an SSH Key item: unencrypted OpenSSH format, protected by the vault.
 * Ed25519 and RSA, like the other apps. This device only reads and makes keys; it doesn't run an SSH agent.
 */
class SSHKey private constructor(private val parts: Parts, val comment: String) {
    private sealed interface Parts {
        class Ed25519(val seed: ByteArray, val publicKey: ByteArray) : Parts
        class Rsa(val n: ByteArray, val e: ByteArray, val d: ByteArray, val p: ByteArray, val q: ByteArray, val iqmp: ByteArray) : Parts
    }

    class Failure(message: String) : Exception(message)

    /** What authorized_keys holds (base64). */
    val publicBlob: ByteArray
        get() = when (val p = parts) {
            is Parts.Ed25519 -> Wire.string("ssh-ed25519") + Wire.string(p.publicKey)
            is Parts.Rsa -> Wire.string("ssh-rsa") + Wire.mpint(p.e) + Wire.mpint(p.n)
        }

    private val wireType get() = if (parts is Parts.Ed25519) "ssh-ed25519" else "ssh-rsa"

    /** An authorized_keys line. */
    val publicKeyLine: String
        get() = "$wireType ${Base64.getEncoder().encodeToString(publicBlob)}" + if (comment.isEmpty()) "" else " $comment"

    /** As `ssh-keygen -l` shows it. */
    val fingerprint: String
        get() = "SHA256:" + Base64.getEncoder().encodeToString(MessageDigest.getInstance("SHA-256").digest(publicBlob)).trimEnd('=')

    val typeName: String
        get() = when (val p = parts) {
            is Parts.Ed25519 -> "Ed25519"
            is Parts.Rsa -> "RSA ${p.n.dropWhile { it.toInt() == 0 }.size * 8}-bit"
        }

    /** The private key in OpenSSH format. */
    val openSSH: String
        get() {
            val check = ByteArray(4).also { SecureRandom().nextBytes(it) }
            val priv = when (val p = parts) {
                is Parts.Ed25519 -> Wire.string("ssh-ed25519") + Wire.string(p.publicKey) + Wire.string(p.seed + p.publicKey)
                is Parts.Rsa -> Wire.string("ssh-rsa") + listOf(p.n, p.e, p.d, p.iqmp, p.p, p.q).fold(ByteArray(0)) { acc, b -> acc + Wire.mpint(b) }
            }
            var section = check + check + priv + Wire.string(comment)
            section += ByteArray((8 - section.size % 8) % 8) { (it + 1).toByte() }
            val body = MAGIC + Wire.string("none") + Wire.string("none") + Wire.string("") + Wire.u32(1) + Wire.string(publicBlob) + Wire.string(section)
            val b64 = Base64.getEncoder().encodeToString(body).chunked(70).joinToString("\n")
            return "-----BEGIN OPENSSH PRIVATE KEY-----\n$b64\n-----END OPENSSH PRIVATE KEY-----\n"
        }

    companion object {
        private val MAGIC = "openssh-key-v1\u0000".toByteArray()

        /** Reads an unencrypted OpenSSH private key. */
        fun parse(text: String): SSHKey {
            val body = text.replace(Regex("-----(BEGIN|END) OPENSSH PRIVATE KEY-----"), "").filterNot { it.isWhitespace() }
            val data = runCatching { Base64.getDecoder().decode(body) }.getOrNull()
            if (data == null || data.size < MAGIC.size || !data.copyOfRange(0, MAGIC.size).contentEquals(MAGIC)) throw Failure("This is not an OpenSSH private key.")
            try {
                val r = Wire.Reader(data.copyOfRange(MAGIC.size, data.size))
                if (r.text() != "none") {
                    throw Failure("This key is protected with a passphrase. Remove it first with ssh-keygen -p, then add it to Boltwork, which keeps it encrypted in your vault.")
                }
                r.string(); r.string()
                if (r.u32() != 1) throw Failure("Multi-key keys are not supported. Use Ed25519 or RSA.")
                r.string()
                val s = Wire.Reader(r.string())
                if (s.u32() != s.u32()) throw Failure("This key file is corrupted.")
                val parts = when (val type = s.text()) {
                    "ssh-ed25519" -> {
                        val pub = s.string()
                        val priv = s.string()
                        if (priv.size != 64) throw Failure("This key file is corrupted.")
                        Parts.Ed25519(priv.copyOfRange(0, 32), pub)
                    }
                    "ssh-rsa" -> {
                        val n = s.mpint(); val e = s.mpint(); val d = s.mpint(); val iqmp = s.mpint(); val p = s.mpint(); val q = s.mpint()
                        Parts.Rsa(n, e, d, p, q, iqmp)
                    }
                    else -> throw Failure("$type keys are not supported. Use Ed25519 or RSA.")
                }
                return SSHKey(parts, s.text())
            } catch (_: Wire.Truncated) {
                throw Failure("This key file is corrupted.")
            }
        }

        /** A new Ed25519 key, the type OpenSSH recommends. */
        fun generateEd25519(comment: String = ""): SSHKey {
            val key = Ed25519PrivateKeyParameters(SecureRandom())
            return SSHKey(Parts.Ed25519(key.encoded, key.generatePublicKey().encoded), comment)
        }
    }

    /** The SSH wire encoding (RFC 4251): big-endian lengths, strings and mpints. */
    internal object Wire {
        class Truncated : Exception()

        fun u32(n: Int) = byteArrayOf((n ushr 24).toByte(), (n ushr 16).toByte(), (n ushr 8).toByte(), n.toByte())
        fun string(b: ByteArray) = u32(b.size) + b
        fun string(s: String) = string(s.toByteArray())
        fun mpint(b: ByteArray): ByteArray {
            val v = BigInteger(1, b).toByteArray()
            return string(if (v.size == 1 && v[0].toInt() == 0) ByteArray(0) else v)
        }

        class Reader(private val bytes: ByteArray) {
            private var offset = 0
            fun take(n: Int): ByteArray {
                if (n < 0 || bytes.size - offset < n) throw Truncated()
                return bytes.copyOfRange(offset, offset + n).also { offset += n }
            }
            fun u32(): Int = take(4).fold(0) { acc, b -> (acc shl 8) or (b.toInt() and 255) }
            fun string() = take(u32())
            fun text() = String(string())
            fun mpint(): ByteArray { val v = string(); return if (v.isNotEmpty() && v[0].toInt() == 0) v.copyOfRange(1, v.size) else v }
        }
    }
}
