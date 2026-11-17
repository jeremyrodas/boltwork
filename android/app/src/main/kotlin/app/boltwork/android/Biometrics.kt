package app.boltwork.android

import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import javax.crypto.Cipher

object Biometrics {
    fun available(activity: FragmentActivity): Boolean =
        BiometricManager.from(activity).canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG) == BiometricManager.BIOMETRIC_SUCCESS

    /** Asks for a fingerprint (or face) and hands back `cipher` unlocked, or null if the user backed out. */
    fun unlock(activity: FragmentActivity, title: String, cipher: Cipher, done: (Cipher?) -> Unit) {
        val prompt = BiometricPrompt(activity, ContextCompat.getMainExecutor(activity), object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) = done(result.cryptoObject?.cipher)
            override fun onAuthenticationError(errorCode: Int, errString: CharSequence) = done(null)
        })
        val info = BiometricPrompt.PromptInfo.Builder()
            .setTitle(title)
            .setNegativeButtonText("Use Password")
            .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
            .build()
        prompt.authenticate(info, BiometricPrompt.CryptoObject(cipher))
    }

    /** Confirms it's the device's owner (fingerprint, face or screen lock) before a passkey is used. True if confirmed or the device has no lock. */
    fun confirm(activity: FragmentActivity, title: String, subtitle: String, done: (Boolean) -> Unit) {
        val allowed = BiometricManager.Authenticators.BIOMETRIC_STRONG or BiometricManager.Authenticators.DEVICE_CREDENTIAL
        if (BiometricManager.from(activity).canAuthenticate(allowed) != BiometricManager.BIOMETRIC_SUCCESS) return done(true)
        val prompt = BiometricPrompt(activity, ContextCompat.getMainExecutor(activity), object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) = done(true)
            override fun onAuthenticationError(errorCode: Int, errString: CharSequence) = done(false)
        })
        prompt.authenticate(BiometricPrompt.PromptInfo.Builder().setTitle(title).setSubtitle(subtitle).setAllowedAuthenticators(allowed).build())
    }
}
