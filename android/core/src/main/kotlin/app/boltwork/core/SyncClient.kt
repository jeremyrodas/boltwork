package app.boltwork.core

import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import java.net.ConnectException
import java.net.HttpURLConnection
import java.net.NoRouteToHostException
import java.net.SocketTimeoutException
import java.net.URL
import java.net.URLEncoder
import java.net.UnknownHostException
import java.security.cert.CertificateException
import java.util.Base64
import javax.net.ssl.SSLException

/** A failed call to the sync server. `status` 0 means the server couldn't be reached. */
class SyncError(val status: Int, message: String) : Exception(message) {
    /** The server no longer accepts this device's sign-in. */
    val isSignedOut: Boolean get() = status == 401
}

/**
 * Talks to a Boltwork sync server (`/api/v1`). Only sealed records, the wrapped master key and
 * KDF parameters ever leave the device. Calls block; run them off the main thread.
 */
class SyncClient(val serverUrl: String, @Volatile var token: String = "") {
    @Serializable data class Health(val ok: Boolean, val signups: String? = null)
    @Serializable data class LoginResponse(val token: String, val accountId: String, val kdf: KdfParams, val wrappedKey: Sealed)
    @Serializable data class Device(val device: String, val createdAt: Long, val lastUsedAt: Long)
    @Serializable data class Account(val email: String, val devices: List<Device>)
    @Serializable data class Page(val records: List<SealedRecord>, val cursor: Int, val more: Boolean)
    @Serializable data class Accepted(val id: String, val rev: Int)
    @Serializable data class PushResult(val accepted: List<Accepted>, val conflicts: List<SealedRecord>)
    @Serializable data class Blob(val id: String, val size: Long, val createdAt: Long)
    @Serializable data class Blobs(val blobs: List<Blob>, val now: Long)
    @Serializable data class Changes(val changed: Boolean, val rev: Int)

    @Serializable private data class PushRecord(val id: String, val kind: RecordKind, val baseRev: Int, val updatedAt: Long, val deleted: Boolean, val data: Sealed?)
    @Serializable private data class PushBody(val records: List<PushRecord>)
    @Serializable private data class EmailBody(val email: String)
    @Serializable private data class Prelogin(val kdf: KdfParams)
    @Serializable private data class LoginBody(val email: String, val authKey: String, val device: String)
    @Serializable private data class SignupBody(val email: String, val authKey: String, val kdf: KdfParams, val wrappedKey: Sealed, val accountId: String, val device: String)
    @Serializable private data class KeysBody(val authKey: String, val kdf: KdfParams, val wrappedKey: Sealed)
    @Serializable private data class Token(val token: String)
    @Serializable private data class ErrorBody(val error: String? = null)
    @Serializable private class Empty

    private fun send(method: String, route: String, body: ByteArray?, timeoutSeconds: Int, contentType: String): Pair<Int, ByteArray> {
        val url = try { URL("$serverUrl/api/v1$route") } catch (_: Exception) { throw SyncError(0, "That server address isn’t valid.") }
        var connection: HttpURLConnection? = null
        try {
            connection = url.openConnection() as HttpURLConnection
            connection.requestMethod = method
            connection.connectTimeout = minOf(timeoutSeconds, 30) * 1000
            connection.readTimeout = timeoutSeconds * 1000
            connection.useCaches = false
            connection.setRequestProperty("content-type", contentType)
            connection.setRequestProperty("accept", "application/json")
            if (token.isNotEmpty()) connection.setRequestProperty("authorization", "Bearer $token")
            if (body != null) {
                connection.doOutput = true
                connection.setFixedLengthStreamingMode(body.size)
                connection.outputStream.use { it.write(body) }
            }
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            return status to (stream?.use { it.readBytes() } ?: ByteArray(0))
        } catch (e: java.io.IOException) {
            throw unreachable(e)
        } finally {
            connection?.disconnect()
        }
    }

    private fun unreachable(e: Exception): SyncError {
        val why = when {
            e is SocketTimeoutException -> "it didn’t answer in time. Check the address and that the server is running."
            e is UnknownHostException -> "that name couldn’t be found. Check the spelling, or use the server’s IP address."
            e is NoRouteToHostException -> "this device is offline."
            e is ConnectException && e.message.orEmpty().contains("unreachable", ignoreCase = true) -> "this device is offline."
            e is ConnectException -> "nothing is listening at that address and port. Check the port and that the server is running."
            e is SSLException && generateSequence<Throwable>(e) { it.cause }.any { it is CertificateException } ->
                "its https certificate isn’t trusted. Use a certificate from a public authority (Caddy or Let’s Encrypt can do this)."
            e is SSLException -> "it doesn’t use https. If it’s on a private network, use http:// instead."
            else -> e.message ?: "the connection failed."
        }
        return SyncError(0, "Can’t reach the sync server at $serverUrl: $why")
    }

    private fun fail(status: Int, data: ByteArray): Nothing {
        val message = runCatching { json.decodeFromString(ErrorBody.serializer(), String(data)).error }.getOrNull()
        throw SyncError(status, message ?: "Sync server error $status.")
    }

    private fun <T> call(reply: KSerializer<T>, method: String, route: String, body: String? = null, timeoutSeconds: Int = 30): T {
        val (status, data) = send(method, route, body?.toByteArray(), timeoutSeconds, "application/json")
        if (status !in 200..299) fail(status, data)
        return try {
            json.decodeFromString(reply, String(data).ifEmpty { "{}" })
        } catch (_: Exception) {
            throw SyncError(status, "The sync server sent a reply this app doesn’t understand.")
        }
    }

    private fun <T> body(serializer: KSerializer<T>, value: T) = json.encodeToString(serializer, value)

    fun health(timeoutSeconds: Int = 30): Health = call(Health.serializer(), "GET", "/health", timeoutSeconds = timeoutSeconds)

    fun prelogin(email: String): KdfParams =
        call(Prelogin.serializer(), "POST", "/prelogin", body(EmailBody.serializer(), EmailBody(email))).kdf

    fun signup(email: String, authKey: ByteArray, keyset: Keyset, device: String) {
        val b = SignupBody(email, base64Url(authKey), keyset.kdf, keyset.wrappedKey, keyset.accountId, device)
        token = call(Token.serializer(), "POST", "/accounts", body(SignupBody.serializer(), b)).token
    }

    fun login(email: String, authKey: ByteArray, device: String): LoginResponse {
        val r = call(LoginResponse.serializer(), "POST", "/login", body(LoginBody.serializer(), LoginBody(email, base64Url(authKey), device)))
        token = r.token
        return r
    }

    fun logout() { call(Empty.serializer(), "POST", "/logout") }
    fun account(): Account = call(Account.serializer(), "GET", "/account")

    /** Waits up to `wait` seconds for the account to change on the server. */
    fun waitForChanges(since: Int, wait: Int = 25): Changes =
        call(Changes.serializer(), "GET", "/changes?since=$since&wait=$wait", timeoutSeconds = wait + 15)

    fun pull(since: Int): Page = call(Page.serializer(), "GET", "/records?since=$since")

    fun push(records: List<SealedRecord>): PushResult {
        val b = PushBody(records.map { PushRecord(it.id, it.kind, it.rev, it.updatedAt, it.isDeleted, it.data) })
        return call(PushResult.serializer(), "POST", "/records", pushJson.encodeToString(PushBody.serializer(), b))
    }

    fun listBlobs(): Blobs = call(Blobs.serializer(), "GET", "/blobs")

    fun deleteBlob(id: String) { call(Empty.serializer(), "DELETE", "/blobs/${encode(id)}") }

    fun putBlob(id: String, bytes: ByteArray) {
        val (status, data) = send("PUT", "/blobs/${encode(id)}", bytes, 600, "application/octet-stream")
        if (status !in 200..299) fail(status, data)
    }

    fun getBlob(id: String): ByteArray? {
        val (status, data) = send("GET", "/blobs/${encode(id)}", null, 600, "application/octet-stream")
        if (status == 404) return null
        if (status !in 200..299) fail(status, data)
        return data
    }

    companion object {
        private val pushJson = kotlinx.serialization.json.Json { encodeDefaults = true; explicitNulls = true }
        private fun base64Url(b: ByteArray) = Base64.getUrlEncoder().withoutPadding().encodeToString(b)
        private fun encode(id: String) = URLEncoder.encode(id, "UTF-8").replace("+", "%20")

        /**
         * A client for the first of `addresses` that answers, so a vault with a backup address keeps
         * syncing when its main one is out of reach. A single address is returned without a probe.
         */
        fun reachable(addresses: List<String>, token: String = "", probeTimeoutSeconds: Int = 5): SyncClient {
            if (addresses.size == 1) return SyncClient(addresses[0], token)
            var first: SyncError? = null
            for (address in addresses) {
                val client = SyncClient(address, token)
                try {
                    client.health(probeTimeoutSeconds)
                    return client
                } catch (e: SyncError) {
                    if (e.status != 0 && e.status < 500) return client
                    if (first == null) first = e
                }
            }
            throw SyncError(0, "${first?.message ?: "Can’t reach the sync server."} Its backup address didn’t answer either.")
        }
    }
}
