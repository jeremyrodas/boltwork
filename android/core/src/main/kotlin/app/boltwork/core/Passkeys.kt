package app.boltwork.core

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.encodeToJsonElement
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject
import java.math.BigInteger
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.MessageDigest
import java.security.Signature
import java.security.interfaces.ECPrivateKey
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec
import java.security.spec.PKCS8EncodedKeySpec
import java.util.Base64

/**
 * A passkey kept on a login item, in the desktop app's format (`src/core/passkeys.ts`), so passkeys made on
 * any Boltwork device sign in everywhere. Binary values are base64url.
 */
@Serializable
data class Passkey(
    val credentialId: String,
    val rpId: String,
    val rpName: String? = null,
    /** The site's user.id. */
    val userHandle: String,
    val userName: String,
    val userDisplayName: String? = null,
    /** PKCS#8 DER of the P-256 private key. */
    val privateKey: String,
    /** -7: ES256, the only algorithm Boltwork makes. */
    val algorithm: Int = -7,
    val createdAt: Long,
    val lastUsedAt: Long? = null,
)

/** The item's passkeys, stored under `passkeys` with the rest of the record. */
val Item.passkeys: List<Passkey>
    get() = (extras["passkeys"] as? JsonArray)?.mapNotNull { runCatching { json.decodeFromJsonElement<Passkey>(it) }.getOrNull() } ?: emptyList()

fun Item.withPasskeys(keys: List<Passkey>): Item =
    copy(extras = if (keys.isEmpty()) extras - "passkeys" else extras + ("passkeys" to json.encodeToJsonElement(keys)))

/** The little CBOR WebAuthn needs: integers, byte and text strings, and maps with keys in canonical order. */
internal sealed interface Cbor {
    data class Int(val n: Long) : Cbor
    class Bytes(val b: ByteArray) : Cbor
    data class Text(val s: String) : Cbor
    class Map(val entries: List<Pair<Cbor, Cbor>>) : Cbor

    val encoded: ByteArray
        get() = when (this) {
            is Int -> if (n >= 0) head(0, n) else head(1, -1 - n)
            is Bytes -> head(2, b.size.toLong()) + b
            is Text -> s.toByteArray().let { head(3, it.size.toLong()) + it }
            is Map -> entries.fold(head(5, entries.size.toLong())) { acc, (k, v) -> acc + k.encoded + v.encoded }
        }

    companion object {
        private fun head(major: kotlin.Int, n: Long): ByteArray {
            val m = major shl 5
            return when {
                n < 24 -> byteArrayOf((m or n.toInt()).toByte())
                n < 0x100 -> byteArrayOf((m or 24).toByte(), n.toByte())
                n < 0x10000 -> byteArrayOf((m or 25).toByte(), (n shr 8).toByte(), n.toByte())
                else -> byteArrayOf((m or 26).toByte(), (n shr 24).toByte(), (n shr 16).toByte(), (n shr 8).toByte(), n.toByte())
            }
        }
    }
}

/**
 * Boltwork as a WebAuthn authenticator, matching the desktop app (`src/core/passkeys.ts`):
 * ES256 keys, "none" attestation, user present and verified, backup eligible and backed up, sign count 0.
 */
object WebAuthn {
    val aaguid: ByteArray = "5d7a6c1e9b3f4c2aa8e15c0d3b7f9e21".chunked(2).map { it.toInt(16).toByte() }.toByteArray()
    private const val UP = 0x01; private const val UV = 0x04; private const val BE = 0x08; private const val BS = 0x10; private const val AT = 0x40

    /** A WebAuthn failure, named as the browser would raise it. */
    class Failure(val name: String, message: String) : Exception(message)

    class NewCredential(val passkey: Passkey, val authenticatorData: ByteArray, val attestationObject: ByteArray, val credentialId: ByteArray, val publicKeySpki: ByteArray)

    fun newCredential(rpId: String, rpName: String?, userHandle: ByteArray, userName: String, userDisplayName: String?, now: Long = System.currentTimeMillis()): NewCredential {
        if (userHandle.size !in 1..64) throw Failure("NotAllowedError", "The site sent a bad user ID.")
        val pair = KeyPairGenerator.getInstance("EC").apply { initialize(ECGenParameterSpec("secp256r1")) }.generateKeyPair()
        val pub = pair.public as ECPublicKey
        val x = fixed(pub.w.affineX); val y = fixed(pub.w.affineY)
        val credId = VaultCrypto.randomBytes(16)
        val cose = Cbor.Map(listOf(
            Cbor.Int(1) to Cbor.Int(2), Cbor.Int(3) to Cbor.Int(-7), Cbor.Int(-1) to Cbor.Int(1),
            Cbor.Int(-2) to Cbor.Bytes(x), Cbor.Int(-3) to Cbor.Bytes(y),
        )).encoded
        val authData = sha256(rpId.toByteArray()) + byteArrayOf((UP or UV or BE or BS or AT).toByte()) + ByteArray(4) + aaguid +
            byteArrayOf((credId.size shr 8).toByte(), credId.size.toByte()) + credId + cose
        val attestation = Cbor.Map(listOf(
            Cbor.Text("fmt") to Cbor.Text("none"), Cbor.Text("attStmt") to Cbor.Map(emptyList()), Cbor.Text("authData") to Cbor.Bytes(authData),
        )).encoded
        val passkey = Passkey(
            credentialId = b64url(credId), rpId = rpId, rpName = rpName?.take(200),
            userHandle = b64url(userHandle), userName = userName.take(200), userDisplayName = userDisplayName?.takeIf { it.isNotEmpty() }?.take(200),
            privateKey = b64url(pkcs8(fixed((pair.private as ECPrivateKey).s), x, y)), algorithm = -7, createdAt = now,
        )
        return NewCredential(passkey, authData, attestation, credId, pub.encoded)
    }

    /** Signs in: authenticator data, and its DER signature over it plus the client data hash. */
    fun assert(passkey: Passkey, rpId: String, clientDataHash: ByteArray): Pair<ByteArray, ByteArray> {
        if (passkey.rpId != rpId) throw Failure("NotAllowedError", "That passkey is for a different site.")
        val key = runCatching { KeyFactory.getInstance("EC").generatePrivate(PKCS8EncodedKeySpec(unb64url(passkey.privateKey))) }.getOrNull()
            ?: throw Failure("NotAllowedError", "This passkey’s key can’t be read.")
        val authData = sha256(rpId.toByteArray()) + byteArrayOf((UP or UV or BE or BS).toByte()) + ByteArray(4)
        val signature = Signature.getInstance("SHA256withECDSA").run { initSign(key); update(authData + clientDataHash); sign() }
        return authData to signature
    }

    // MARK: Requests from apps and browsers (the JSON of navigator.credentials, as Android passes it)

    /** The relying party a caller may use. Browsers: the page's host or a registrable parent. Apps: checked by the caller against the site's asset links. */
    fun checkRpId(rpId: String, pageHost: String?): String {
        val id = rpId.lowercase()
        if (pageHost != null) {
            val host = pageHost.lowercase()
            if (id != host && !host.endsWith(".$id")) throw Failure("SecurityError", "This page can’t use passkeys for $id.")
            if (id == "localhost" || id.endsWith(".localhost")) return id
            if (id.all { it.isDigit() || it == '.' } || ':' in id) { if (id != host) throw Failure("SecurityError", "Bad relying party."); return id }
        }
        val labels = id.split('.')
        if (labels.size < 2 || labels.any { it.isEmpty() } || !id.endsWith(Domain.base(id)) || Domain.base(id).split('.').size > labels.size ||
            (labels.size == 2 && id in setOf("co.uk", "org.uk", "ac.uk", "gov.uk", "com.au", "net.au", "co.nz", "co.jp", "com.br", "co.in", "co.za", "com.mx"))
        ) throw Failure("SecurityError", "$id isn’t a domain a site can own.")
        return id
    }

    /** `{type, challenge, origin, crossOrigin}`, in the order the WebAuthn spec serializes them. */
    fun clientDataJSON(type: String, challenge: String, origin: String, androidPackage: String? = null): ByteArray {
        val o = buildJsonObject {
            put("type", type); put("challenge", challenge); put("origin", origin); put("crossOrigin", false)
            if (androidPackage != null) put("androidPackageName", androidPackage)
        }
        return o.toString().toByteArray()
    }

    private fun validChallenge(request: JsonObject): String {
        val c = request.string("challenge")
        if (c == null || (runCatching { unb64url(c) }.getOrNull()?.size ?: 0) < 16) throw Failure("NotAllowedError", "The site sent a bad challenge.")
        return c
    }

    fun parse(requestJson: String): JsonObject =
        runCatching { json.parseToJsonElement(requestJson).jsonObject }.getOrElse { throw Failure("NotAllowedError", "The request couldn’t be read.") }

    /** The relying party ID a create request names. */
    fun createRpId(request: JsonObject): String? = (request["rp"] as? JsonObject)?.string("id")

    /** The relying party ID a get request names. */
    fun getRpId(request: JsonObject): String? = request.string("rpId")

    /** The user a create request is for, to offer the right login. */
    fun createUserName(request: JsonObject): String = (request["user"] as? JsonObject)?.string("name").orEmpty()

    /** Credential IDs the site already has, which must not be registered again. */
    fun excluded(request: JsonObject): Set<String> = (request["excludeCredentials"] as? JsonArray)?.mapNotNull { (it as? JsonObject)?.string("id") }?.toSet() ?: emptySet()

    /**
     * Makes a passkey for a create request. With "none" attestation nothing is signed, so a browser's own client data
     * hash isn't needed. Returns the passkey to save and the response JSON.
     */
    fun create(request: JsonObject, rpId: String, origin: String, androidPackage: String?): Pair<Passkey, String> {
        val params = (request["pubKeyCredParams"] as? JsonArray).orEmpty()
        if (params.none { (it as? JsonObject)?.let { p -> p.string("type") == "public-key" && p["alg"]?.jsonPrimitive?.intOrNull == -7 } == true }) {
            throw Failure("NotSupportedError", "This site doesn’t accept the passkey type Boltwork makes.")
        }
        val challenge = validChallenge(request)
        val user = request["user"] as? JsonObject
        val userId = user?.string("id")?.let { runCatching { unb64url(it) }.getOrNull() } ?: throw Failure("NotAllowedError", "The site sent a bad user ID.")
        val made = newCredential(rpId, (request["rp"] as? JsonObject)?.string("name"), userId, user.string("name").orEmpty(), user.string("displayName"))
        val clientData = clientDataJSON("webauthn.create", challenge, origin, androidPackage)
        val id = made.passkey.credentialId
        val credProps = ((request["extensions"] as? JsonObject)?.get("credProps") as? JsonPrimitive)?.booleanOrNull == true
        val response = buildJsonObject {
            put("id", id); put("rawId", id); put("type", "public-key"); put("authenticatorAttachment", "platform")
            putJsonObject("response") {
                put("clientDataJSON", b64url(clientData))
                put("attestationObject", b64url(made.attestationObject))
                put("authenticatorData", b64url(made.authenticatorData))
                put("publicKey", b64url(made.publicKeySpki))
                put("publicKeyAlgorithm", -7)
                put("transports", buildJsonArray { add(JsonPrimitive("hybrid")); add(JsonPrimitive("internal")) })
            }
            putJsonObject("clientExtensionResults") { if (credProps) putJsonObject("credProps") { put("rk", true) } }
        }
        return made.passkey to response.toString()
    }

    /** Which passkeys a get request may use. */
    fun usable(passkeys: List<Passkey>, request: JsonObject, rpId: String): List<Passkey> {
        val allowed = (request["allowCredentials"] as? JsonArray)?.mapNotNull { (it as? JsonObject)?.string("id") }?.toSet().orEmpty()
        return passkeys.filter { it.rpId == rpId && (allowed.isEmpty() || it.credentialId in allowed) }
    }

    /** Signs in with a passkey the person picked. Returns the response JSON. */
    fun get(passkey: Passkey, request: JsonObject, rpId: String, origin: String, clientDataHash: ByteArray?, androidPackage: String?): String {
        val challenge = validChallenge(request)
        val clientData = clientDataJSON("webauthn.get", challenge, origin, androidPackage)
        val (authData, signature) = assert(passkey, rpId, clientDataHash ?: sha256(clientData))
        return buildJsonObject {
            put("id", passkey.credentialId); put("rawId", passkey.credentialId); put("type", "public-key"); put("authenticatorAttachment", "platform")
            putJsonObject("response") {
                put("clientDataJSON", b64url(clientData))
                put("authenticatorData", b64url(authData))
                put("signature", b64url(signature))
                put("userHandle", passkey.userHandle)
            }
            putJsonObject("clientExtensionResults") {}
        }.toString()
    }

    fun sha256(b: ByteArray): ByteArray = MessageDigest.getInstance("SHA-256").digest(b)
    fun b64url(b: ByteArray): String = Base64.getUrlEncoder().withoutPadding().encodeToString(b)
    fun unb64url(s: String): ByteArray = Base64.getUrlDecoder().decode(s.trimEnd('='))

    private fun JsonObject.string(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull

    private fun fixed(n: BigInteger): ByteArray {
        val b = n.toByteArray().let { if (it.size > 32) it.copyOfRange(it.size - 32, it.size) else it }
        return ByteArray(32 - b.size) + b
    }

    /** PKCS#8 for a P-256 key with its public point, as CryptoKit and WebCrypto write it. */
    private fun pkcs8(d: ByteArray, x: ByteArray, y: ByteArray): ByteArray {
        val head = "308187020100301306072a8648ce3d020106082a8648ce3d030107046d306b0201010420".chunked(2).map { it.toInt(16).toByte() }.toByteArray()
        val mid = "a144034200".chunked(2).map { it.toInt(16).toByte() }.toByteArray()
        return head + d + mid + byteArrayOf(4) + x + y
    }
}
