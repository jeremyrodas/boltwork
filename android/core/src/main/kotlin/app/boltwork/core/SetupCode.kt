package app.boltwork.core

import kotlinx.serialization.Serializable

/** What a new device needs to sign in, minus the account password. Shown as a QR code by the other apps. */
data class SetupCode(val server: String? = null, val backup: String? = null, val email: String? = null, val secretKey: String) {
    class Error(message: String) : Exception(message)

    @Serializable
    private data class Payload(val v: Int, val server: String? = null, val backup: String? = null, val email: String? = null, val secretKey: String? = null)

    val text: String
        get() = PREFIX + json.encodeToString(Payload.serializer(), Payload(VERSION, filled(server), filled(backup), filled(email), secretKey))

    companion object {
        const val PREFIX = "boltwork-setup:"
        private const val VERSION = 1

        private fun filled(value: String?) = value?.takeIf { it.isNotEmpty() }

        fun parse(text: String): SetupCode {
            val trimmed = text.trim()
            val payload = if (!trimmed.startsWith(PREFIX)) null else runCatching {
                json.decodeFromString(Payload.serializer(), trimmed.removePrefix(PREFIX))
            }.getOrNull()
            payload ?: throw Error("That isn’t a Boltwork setup code.")
            if (payload.v != VERSION) throw Error("This setup code needs a newer version of Boltwork.")
            val secretKey = filled(payload.secretKey) ?: throw Error("That isn’t a Boltwork setup code.")
            return SetupCode(filled(payload.server), filled(payload.backup), filled(payload.email), secretKey)
        }
    }
}
