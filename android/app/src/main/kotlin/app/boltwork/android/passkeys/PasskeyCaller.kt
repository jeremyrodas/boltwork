package app.boltwork.android.passkeys

import android.content.Context
import androidx.credentials.provider.CallingAppInfo
import app.boltwork.android.BuildConfig
import app.boltwork.android.R
import app.boltwork.core.WebAuthn
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.security.MessageDigest

/**
 * Who is asking for a passkey, and whether they may use a relying party ID.
 * Browsers are trusted to report the page's origin only if their signing certificate is on the allowlist; apps must be
 * named in the site's Digital Asset Links file, the way Android's own password manager checks them.
 */
class PasskeyCaller private constructor(
    val origin: String,
    /** The web page's host, when a browser is asking. */
    val pageHost: String?,
    /** The app, when an app is asking for itself. */
    val appPackage: String?,
    private val certFingerprint: String?,
    private val appName: String? = null,
) {
    val label: String get() = pageHost ?: appName ?: appPackage ?: "this app"

    /** The relying party ID to use, or a failure if this caller may not use it. */
    suspend fun checkRpId(requested: String?): String {
        if (pageHost != null) return WebAuthn.checkRpId(requested ?: pageHost, pageHost)
        val rpId = requested?.lowercase() ?: throw WebAuthn.Failure("SecurityError", "The app didn’t say which site the passkey is for.")
        if (BuildConfig.DEBUG && (rpId == "localhost" || rpId.endsWith(".localhost"))) return rpId // test apps, in test builds only
        WebAuthn.checkRpId(rpId, null)
        if (!assetLinksAllow(rpId)) throw WebAuthn.Failure("SecurityError", "$rpId hasn’t listed this app as allowed to use its passkeys.")
        return rpId
    }

    private suspend fun assetLinksAllow(rpId: String): Boolean = withContext(Dispatchers.IO) {
        runCatching {
            val connection = URL("https://$rpId/.well-known/assetlinks.json").openConnection() as HttpURLConnection
            connection.connectTimeout = 8000; connection.readTimeout = 8000; connection.instanceFollowRedirects = false
            connection.inputStream.use { stream ->
                val statements = Json.parseToJsonElement(stream.readBytes().decodeToString()) as JsonArray
                statements.any { s ->
                    val o = s as? JsonObject ?: return@any false
                    val relations = (o["relation"] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.content }.orEmpty()
                    val target = o["target"] as? JsonObject ?: return@any false
                    "delegate_permission/common.get_login_creds" in relations &&
                        (target["namespace"] as? JsonPrimitive)?.content == "android_app" &&
                        (target["package_name"] as? JsonPrimitive)?.content == appPackage &&
                        (target["sha256_cert_fingerprints"] as? JsonArray)?.any { (it as? JsonPrimitive)?.content.equals(certFingerprint, ignoreCase = true) } == true
                }
            }
        }.getOrDefault(false)
    }

    companion object {
        fun of(context: Context, info: CallingAppInfo): PasskeyCaller {
            if (info.isOriginPopulated()) {
                val allowlist = context.resources.openRawResource(R.raw.privileged_browsers).use { it.readBytes().decodeToString() }
                val origin = runCatching { info.getOrigin(allowlist) }.getOrNull()
                    ?: throw WebAuthn.Failure("SecurityError", "Boltwork doesn’t recognize this browser, so it can’t trust which website is asking.")
                val host = runCatching { URI(origin).host?.lowercase() }.getOrNull()?.takeIf { it.isNotEmpty() }
                    ?: throw WebAuthn.Failure("SecurityError", "This page has no usable address.")
                if (!origin.startsWith("https://") && !(origin.startsWith("http://") && (host == "localhost" || host.endsWith(".localhost")))) {
                    throw WebAuthn.Failure("SecurityError", "Passkeys need a secure (https) page.")
                }
                return PasskeyCaller(origin.trimEnd('/'), host, null, null)
            }
            // The current signer (with key rotation, the history's last entry; apkContentsSigners gives it directly).
            val cert = info.signingInfo.apkContentsSigners?.firstOrNull()?.toByteArray() ?: throw WebAuthn.Failure("SecurityError", "The app asking couldn’t be identified.")
            val digest = MessageDigest.getInstance("SHA-256").digest(cert)
            return PasskeyCaller(
                "android:apk-key-hash:" + WebAuthn.b64url(digest), null, info.packageName,
                digest.joinToString(":") { "%02X".format(it) },
                runCatching { context.packageManager.run { getApplicationLabel(getApplicationInfo(info.packageName, 0)).toString() } }.getOrNull(),
            )
        }
    }
}
