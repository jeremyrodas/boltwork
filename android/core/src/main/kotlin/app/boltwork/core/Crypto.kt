package app.boltwork.core

import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.Json
import org.bouncycastle.crypto.digests.Blake2bDigest
import org.bouncycastle.crypto.generators.Argon2BytesGenerator
import org.bouncycastle.crypto.modes.ChaCha20Poly1305
import org.bouncycastle.crypto.params.AEADParameters
import org.bouncycastle.crypto.params.Argon2Parameters
import org.bouncycastle.crypto.params.KeyParameter
import java.security.SecureRandom
import java.text.Normalizer
import java.util.Base64

/** A sealed blob: base64 nonce and base64 ciphertext-with-tag. */
@Serializable
data class Sealed(val n: String, val c: String)

/** Argon2id parameters stored in the vault header. `mem` is in bytes. */
@Serializable
data class KdfParams(val alg: String, val salt: String, val ops: Int, val mem: Int)

data class KdfCost(val ops: Int, val mem: Int)

/** JSON settings shared by the vault file, records and the sync server. */
internal val json = Json {
    ignoreUnknownKeys = true
    encodeDefaults = true
    explicitNulls = false
}

internal fun ByteArray.base64(): String = Base64.getEncoder().encodeToString(this)
internal fun String.unbase64(): ByteArray? = try { Base64.getDecoder().decode(this) } catch (_: IllegalArgumentException) { null }
fun ByteArray.hex(): String = joinToString("") { "%02x".format(it) }

/**
 * Key derivation and sealing, matching `src/core/crypto.ts`.
 *
 * The account password is stretched with Argon2id, then mixed with the 128-bit Secret Key through keyed
 * BLAKE2b. Everything is sealed with XChaCha20-Poly1305 and bound to its purpose with associated data.
 */
object VaultCrypto {
    /** Argon2id cost for new vaults: 3 passes over 128 MiB, the desktop app's default. */
    val strongCost = KdfCost(ops = 3, mem = 128 * 1024 * 1024)
    val fastCostForTests = KdfCost(ops = 2, mem = 16 * 1024 * 1024)

    private val random = SecureRandom()

    fun newKdfParams(cost: KdfCost = strongCost) = KdfParams("argon2id13", randomBytes(16).base64(), cost.ops, cost.mem)

    /** The key-encryption key, from password + Secret Key. Slow: runs Argon2id. */
    fun deriveKek(password: String, secretKey: String, kdf: KdfParams): ByteArray {
        val normalized = SecretKey.normalize(secretKey)
        val stretched = stretch(password, kdf)
        try {
            return blake2b(stretched, 32, key = normalized.toByteArray())
        } finally {
            stretched.fill(0)
        }
    }

    /** The sync sign-in key: a one-way derivative of the KEK, so the server learns nothing that decrypts the vault. */
    fun authKey(kek: ByteArray): ByteArray =
        // Internal format labels keep the app's earlier name (Strongroom).
        blake2b("strongroom:sync-auth:v1".toByteArray(), 32, key = kek)

    private fun stretch(password: String, kdf: KdfParams): ByteArray {
        val salt = kdf.salt.unbase64()
        if (kdf.alg != "argon2id13" || salt == null) throw VaultError.UnsupportedFormat()
        val normalized = Normalizer.normalize(password, Normalizer.Form.NFKD).toByteArray()
        return argon2id(normalized, salt, kdf.ops, kdf.mem / 1024)
    }

    /**
     * A faster Argon2id (version 1.3, one lane, 32 bytes out) for platforms that have one: arguments are
     * password, salt, iterations and memory in KiB. The built-in one is correct everywhere but slow on phones.
     */
    @Volatile var nativeArgon2id: ((ByteArray, ByteArray, Int, Int) -> ByteArray)? = null

    internal fun argon2id(password: ByteArray, salt: ByteArray, iterations: Int, memoryKiB: Int): ByteArray {
        nativeArgon2id?.let { return it(password, salt, iterations, memoryKiB) }
        val params = Argon2Parameters.Builder(Argon2Parameters.ARGON2_id)
            .withVersion(Argon2Parameters.ARGON2_VERSION_13)
            .withIterations(iterations)
            .withMemoryAsKB(memoryKiB)
            .withParallelism(1)
            .withSalt(salt)
            .build()
        val out = ByteArray(32)
        Argon2BytesGenerator().apply { init(params) }.generateBytes(password, out)
        return out
    }

    internal fun blake2b(message: ByteArray, outputLength: Int, key: ByteArray? = null): ByteArray {
        val digest = if (key == null) Blake2bDigest(outputLength * 8) else Blake2bDigest(key, outputLength, null, null)
        digest.update(message, 0, message.size)
        return ByteArray(outputLength).also { digest.doFinal(it, 0) }
    }

    fun randomKey(): ByteArray = randomBytes(32)
    fun randomBytes(count: Int): ByteArray = ByteArray(count).also(random::nextBytes)

    /** A random 24-character hex id, like the desktop app's `randomId()`. */
    fun randomId(): String = randomBytes(12).hex()

    fun seal(plaintext: ByteArray, key: ByteArray, aad: String): Sealed {
        val nonce = randomBytes(XChaCha20Poly1305.NONCE_LENGTH)
        return Sealed(nonce.base64(), XChaCha20Poly1305.seal(plaintext, key, nonce, aad.toByteArray()).base64())
    }

    fun open(sealed: Sealed, key: ByteArray, aad: String): ByteArray {
        val nonce = sealed.n.unbase64() ?: throw VaultError.DecryptionFailed()
        val c = sealed.c.unbase64() ?: throw VaultError.DecryptionFailed()
        return XChaCha20Poly1305.open(c, key, nonce, aad.toByteArray())
    }

    fun <T> sealJson(serializer: KSerializer<T>, value: T, key: ByteArray, aad: String): Sealed =
        seal(json.encodeToString(serializer, value).toByteArray(), key, aad)

    fun <T> openJson(serializer: KSerializer<T>, sealed: Sealed, key: ByteArray, aad: String): T {
        val plain = open(sealed, key, aad)
        try {
            return json.decodeFromString(serializer, String(plain))
        } finally {
            plain.fill(0)
        }
    }

    /** The master key is stored as a JSON array of numbers, as the desktop app writes it. */
    internal val keySerializer = ListSerializer(Int.serializer())
}

/** XChaCha20-Poly1305 (IETF), as libsodium's `crypto_aead_xchacha20poly1305_ietf`. */
internal object XChaCha20Poly1305 {
    const val NONCE_LENGTH = 24

    fun seal(plaintext: ByteArray, key: ByteArray, nonce: ByteArray, aad: ByteArray): ByteArray = run(true, plaintext, key, nonce, aad)

    fun open(ciphertext: ByteArray, key: ByteArray, nonce: ByteArray, aad: ByteArray): ByteArray = run(false, ciphertext, key, nonce, aad)

    private fun run(sealing: Boolean, input: ByteArray, key: ByteArray, nonce: ByteArray, aad: ByteArray): ByteArray {
        if (key.size != 32 || nonce.size != NONCE_LENGTH || (!sealing && input.size < 16)) throw VaultError.DecryptionFailed()
        val subkey = hchacha20(key, nonce)
        try {
            val cipher = ChaCha20Poly1305()
            cipher.init(sealing, AEADParameters(KeyParameter(subkey), 128, ByteArray(4) + nonce.copyOfRange(16, 24), aad))
            val out = ByteArray(cipher.getOutputSize(input.size))
            val n = cipher.processBytes(input, 0, input.size, out, 0)
            cipher.doFinal(out, n)
            return out
        } catch (_: Exception) {
            throw VaultError.DecryptionFailed()
        } finally {
            subkey.fill(0)
        }
    }

    private fun word(b: ByteArray, i: Int) =
        (b[i].toInt() and 255) or ((b[i + 1].toInt() and 255) shl 8) or ((b[i + 2].toInt() and 255) shl 16) or ((b[i + 3].toInt() and 255) shl 24)

    /** The subkey from the key and the first 16 nonce bytes. */
    private fun hchacha20(key: ByteArray, nonce: ByteArray): ByteArray {
        val x = IntArray(16)
        x[0] = 0x61707865; x[1] = 0x3320646e; x[2] = 0x79622d32; x[3] = 0x6b206574
        for (i in 0 until 8) x[4 + i] = word(key, i * 4)
        for (i in 0 until 4) x[12 + i] = word(nonce, i * 4)
        fun quarter(a: Int, b: Int, c: Int, d: Int) {
            x[a] += x[b]; x[d] = (x[d] xor x[a]).rotateLeft(16)
            x[c] += x[d]; x[b] = (x[b] xor x[c]).rotateLeft(12)
            x[a] += x[b]; x[d] = (x[d] xor x[a]).rotateLeft(8)
            x[c] += x[d]; x[b] = (x[b] xor x[c]).rotateLeft(7)
        }
        repeat(10) {
            quarter(0, 4, 8, 12); quarter(1, 5, 9, 13); quarter(2, 6, 10, 14); quarter(3, 7, 11, 15)
            quarter(0, 5, 10, 15); quarter(1, 6, 11, 12); quarter(2, 7, 8, 13); quarter(3, 4, 9, 14)
        }
        val out = ByteArray(32)
        for ((n, i) in (listOf(0, 1, 2, 3, 12, 13, 14, 15)).withIndex()) {
            for (b in 0 until 4) out[n * 4 + b] = (x[i] ushr (8 * b)).toByte()
        }
        return out
    }
}

/** The account's Secret Key: "SR1-" and 26 Crockford base32 characters (128 bits). */
object SecretKey {
    private const val ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

    fun generate(): String {
        var bits = 0
        var value = 0
        val out = StringBuilder()
        for (byte in VaultCrypto.randomBytes(16)) {
            value = (value shl 8) or (byte.toInt() and 255)
            bits += 8
            while (bits >= 5) {
                out.append(ALPHABET[(value shr (bits - 5)) and 31])
                bits -= 5
            }
            value = value and ((1 shl bits) - 1)
        }
        if (bits > 0) out.append(ALPHABET[(value shl (5 - bits)) and 31])
        return format(out.toString())
    }

    /** Accepts any case, spacing or dashes, and the look-alikes O, I and L. */
    fun normalize(input: String): String {
        var raw = input.uppercase().filter { it in 'A'..'Z' || it in '0'..'9' }
        if (raw.startsWith("SR1")) raw = raw.drop(3)
        raw = raw.map {
            when (it) {
                'O' -> '0'
                'I', 'L' -> '1'
                else -> it
            }
        }.joinToString("")
        if (raw.length != 26 || !raw.all(ALPHABET::contains)) throw VaultError.InvalidSecretKey()
        return format(raw)
    }

    private fun format(c: String) =
        "SR1-" + listOf(c.substring(0, 6), c.substring(6, 11), c.substring(11, 16), c.substring(16, 21), c.substring(21)).joinToString("-")
}

sealed class VaultError(message: String) : Exception(message) {
    class WrongPassword : VaultError("Incorrect password or Secret Key.")
    class InvalidSecretKey : VaultError("That Secret Key is not valid. It starts with SR1- and has 26 more characters.")
    class DecryptionFailed : VaultError("This data couldn’t be decrypted. It may be damaged.")
    class UnsupportedFormat : VaultError("This is not a Boltwork vault.")
    class NewerVersion : VaultError("This vault was made by a newer version of Boltwork.")
    class VaultExists : VaultError("A vault already exists here.")
    class PasswordTooShort : VaultError("Use at least 8 characters for your account password.")
    class Locked : VaultError("The vault is locked.")
    class NotFound(what: String) : VaultError("$what not found.")
    class AttachmentTooLarge : VaultError("Attachments can be up to 100 MB.")
    class AttachmentNotDownloaded : VaultError("This file hasn’t downloaded to this device yet. It will after the next sync.")
    class LastVault : VaultError("You need at least one vault.")
}
