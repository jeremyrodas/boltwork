package app.boltwork.android

import android.content.Context
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * What this device keeps so the user doesn't retype it: the Secret Key and sync sign-in, sealed with a key
 * the system keystore holds, and (for fingerprint unlock) the vault's master key, sealed with a second key
 * the keystore only releases after a fingerprint or face match.
 */
class DeviceSecrets(context: Context) {
    private val prefs = context.getSharedPreferences("device-secrets", Context.MODE_PRIVATE)
    private val keystore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

    private fun key(alias: String, biometric: Boolean): SecretKey {
        (keystore.getKey(alias, null) as? SecretKey)?.let { return it }
        val spec = KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
        if (biometric) {
            spec.setUserAuthenticationRequired(true).setInvalidatedByBiometricEnrollment(true)
            if (Build.VERSION.SDK_INT >= 30) spec.setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG)
        }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").run {
            init(spec.build())
            generateKey()
        }
    }

    private fun cipher() = Cipher.getInstance("AES/GCM/NoPadding")
    private fun encode(b: ByteArray) = Base64.encodeToString(b, Base64.NO_WRAP)
    private fun decode(s: String) = Base64.decode(s, Base64.NO_WRAP)

    private fun store(name: String, cipher: Cipher, value: ByteArray) {
        prefs.edit().putString(name, encode(cipher.iv) + ":" + encode(cipher.doFinal(value))).apply()
    }

    operator fun set(name: String, value: String) {
        store(name, cipher().apply { init(Cipher.ENCRYPT_MODE, key(DEVICE_KEY, false)) }, value.toByteArray())
    }

    operator fun get(name: String): String? = try {
        val (iv, sealed) = prefs.getString(name, null)!!.split(":")
        val c = cipher().apply { init(Cipher.DECRYPT_MODE, key(DEVICE_KEY, false), GCMParameterSpec(128, decode(iv))) }
        String(c.doFinal(decode(sealed)))
    } catch (_: Exception) {
        null
    }

    /** Forgets everything, for signing out. */
    fun clear() {
        prefs.edit().clear().apply()
        for (alias in listOf(DEVICE_KEY, BIOMETRIC_KEY)) runCatching { keystore.deleteEntry(alias) }
    }

    // Fingerprint unlock

    val hasQuickUnlock: Boolean get() = prefs.contains(MASTER_KEY)

    fun removeQuickUnlock() {
        prefs.edit().remove(MASTER_KEY).apply()
        runCatching { keystore.deleteEntry(BIOMETRIC_KEY) }
    }

    /** A cipher the fingerprint prompt unlocks, for `saveQuickUnlock`. Throws if the device has no fingerprint set up. */
    fun cipherForSaving(): Cipher {
        runCatching { keystore.deleteEntry(BIOMETRIC_KEY) }
        return cipher().apply { init(Cipher.ENCRYPT_MODE, key(BIOMETRIC_KEY, true)) }
    }

    fun saveQuickUnlock(unlocked: Cipher, masterKey: ByteArray) = store(MASTER_KEY, unlocked, masterKey)

    /** A cipher the fingerprint prompt unlocks, for `openQuickUnlock`. Null (and turned off) if fingerprints changed since. */
    fun cipherForOpening(): Cipher? = try {
        val iv = prefs.getString(MASTER_KEY, null)!!.split(":")[0]
        cipher().apply { init(Cipher.DECRYPT_MODE, key(BIOMETRIC_KEY, true), GCMParameterSpec(128, decode(iv))) }
    } catch (_: KeyPermanentlyInvalidatedException) {
        removeQuickUnlock()
        null
    } catch (_: Exception) {
        null
    }

    fun openQuickUnlock(unlocked: Cipher): ByteArray = unlocked.doFinal(decode(prefs.getString(MASTER_KEY, null)!!.split(":")[1]))

    companion object {
        const val SECRET_KEY = "secretKey"
        const val TOKEN = "syncToken"
        private const val MASTER_KEY = "masterKey"
        private const val DEVICE_KEY = "boltwork.device"
        private const val BIOMETRIC_KEY = "boltwork.biometric"
    }
}
