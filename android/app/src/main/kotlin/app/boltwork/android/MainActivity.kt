package app.boltwork.android

import android.app.Application
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.fragment.app.FragmentActivity
import app.boltwork.android.ui.BoltworkApp
import app.boltwork.core.VaultCrypto
import com.lambdapioneer.argon2kt.Argon2Kt
import com.lambdapioneer.argon2kt.Argon2Mode
import com.lambdapioneer.argon2kt.Argon2Version

class BoltworkApplication : Application() {
    val model by lazy { AppModel(this) }

    override fun onCreate() {
        super.onCreate()
        // Key derivation in native code: the same result as the built-in one, many times faster on a phone.
        val argon2 = Argon2Kt()
        VaultCrypto.nativeArgon2id = { password, salt, iterations, memoryKiB ->
            argon2.hash(Argon2Mode.ARGON2_ID, password, salt, iterations, memoryKiB, 1, 32, Argon2Version.V13).rawHashAsByteArray()
        }
    }
}

class MainActivity : FragmentActivity() {
    private val model get() = (application as BoltworkApplication).model

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Keeps the vault out of screenshots and the recent-apps preview.
        if (!BuildConfig.DEBUG) window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)
        enableEdgeToEdge()
        setContent { BoltworkApp(model) }
    }

    override fun onStart() {
        super.onStart()
        model.cameBack()
    }

    override fun onStop() {
        super.onStop()
        if (!isChangingConfigurations) model.leftApp()
    }
}
