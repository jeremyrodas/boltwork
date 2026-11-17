package app.boltwork.android.autofill

import android.app.assist.AssistStructure
import android.text.InputType
import android.view.View
import android.view.autofill.AutofillId
import app.boltwork.core.LoginMatch

/** The sign-in fields on the screen asking to fill, and the site or app they belong to. */
class AutofillForm(
    val usernames: List<AutofillId>,
    val passwords: List<AutofillId>,
    val codes: List<AutofillId>,
    val match: LoginMatch,
    /** What was typed, for saving. */
    val typedUsername: String?,
    val typedPassword: String?,
) {
    val allIds get() = usernames + passwords + codes

    companion object {
        /** Browsers that report the website's domain honestly. Any other app's claimed domain is ignored. */
        private val browsers = setOf(
            "com.android.chrome", "com.chrome.beta", "com.chrome.dev", "com.chrome.canary", "com.google.android.apps.chrome",
            "org.mozilla.firefox", "org.mozilla.firefox_beta", "org.mozilla.fenix", "org.mozilla.focus",
            "com.brave.browser", "com.microsoft.emmx", "com.opera.browser", "com.sec.android.app.sbrowser",
            "com.duckduckgo.mobile.android", "com.vivaldi.browser", "com.kiwibrowser.browser", "org.chromium.chrome",
        )

        fun parse(structure: AssistStructure, appName: (String) -> String? = { null }): AutofillForm? {
            val pkg = structure.activityComponent?.packageName
            if (pkg == null || pkg.startsWith("app.boltwork.")) return null
            val usernames = mutableListOf<AutofillId>()
            val passwords = mutableListOf<AutofillId>()
            val codes = mutableListOf<AutofillId>()
            val textFields = mutableListOf<AssistStructure.ViewNode>()
            var webDomain: String? = null
            var typedUsername: String? = null
            var typedPassword: String? = null

            fun visit(node: AssistStructure.ViewNode) {
                node.webDomain?.takeIf { it.isNotBlank() }?.let { if (webDomain == null) webDomain = it }
                val id = node.autofillId
                if (id != null && node.autofillType == View.AUTOFILL_TYPE_TEXT && node.visibility == View.VISIBLE) {
                    val value = node.autofillValue?.takeIf { it.isText }?.textValue?.toString()?.takeIf { it.isNotEmpty() }
                    when (kind(node)) {
                        Kind.Username -> { usernames += id; if (typedUsername == null) typedUsername = value }
                        Kind.Password -> { passwords += id; if (typedPassword == null) typedPassword = value }
                        Kind.Code -> codes += id
                        Kind.Text -> textFields += node
                        Kind.Other -> {}
                    }
                    if (kind(node) == Kind.Password && usernames.isEmpty()) {
                        // No marked username field: the text field just before the password usually is one.
                        textFields.lastOrNull()?.let { usernames += it.autofillId!!; typedUsername = it.autofillValue?.takeIf { v -> v.isText }?.textValue?.toString()?.takeIf { v -> v.isNotEmpty() } }
                    }
                }
                for (i in 0 until node.childCount) visit(node.getChildAt(i))
            }
            for (i in 0 until structure.windowNodeCount) visit(structure.getWindowNodeAt(i).rootViewNode)

            if (passwords.isEmpty() && codes.isEmpty() && usernames.isEmpty()) return null
            val domain = if (pkg in browsers) webDomain else null
            // A browser page with no domain can't be matched safely.
            if (pkg in browsers && domain == null) return null
            return AutofillForm(usernames.distinct(), passwords.distinct(), codes.distinct(), LoginMatch(domain, if (domain == null) pkg else null, if (domain == null) appName(pkg) else null), typedUsername, typedPassword)
        }

        private enum class Kind { Username, Password, Code, Text, Other }

        private fun kind(node: AssistStructure.ViewNode): Kind {
            val hints = node.autofillHints.orEmpty().map { it.lowercase() }
            if (hints.any { "otp" in it || "one-time" in it || "2fa" in it || "sms" in it }) return Kind.Code
            if (hints.any { "password" in it }) return Kind.Password
            if (hints.any { it == View.AUTOFILL_HINT_USERNAME.lowercase() || it == View.AUTOFILL_HINT_EMAIL_ADDRESS.lowercase() || "username" in it || "email" in it }) return Kind.Username

            val html = node.htmlInfo
            if (html != null) {
                if (!html.tag.equals("input", true)) return Kind.Other
                val attrs = html.attributes.orEmpty().associate { it.first.lowercase() to (it.second ?: "").lowercase() }
                val type = attrs["type"] ?: "text"
                val auto = attrs["autocomplete"].orEmpty()
                val name = "${attrs["name"]} ${attrs["id"]}"
                return when {
                    "one-time-code" in auto || Regex("otp|totp|2fa|mfa|one.?time|verification.?code").containsMatchIn(name) -> Kind.Code
                    type == "password" || "password" in auto -> Kind.Password
                    "username" in auto || type == "email" || "email" in auto || Regex("user|login|email|account").containsMatchIn(name) -> Kind.Username
                    type in setOf("text", "tel") -> Kind.Text
                    else -> Kind.Other
                }
            }

            val input = node.inputType
            if (input and InputType.TYPE_MASK_CLASS == InputType.TYPE_CLASS_TEXT) {
                val variation = input and InputType.TYPE_MASK_VARIATION
                if (variation == InputType.TYPE_TEXT_VARIATION_PASSWORD || variation == InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD || variation == InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD) return Kind.Password
                if (variation == InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS || variation == InputType.TYPE_TEXT_VARIATION_WEB_EMAIL_ADDRESS) return Kind.Username
            }
            if (input and InputType.TYPE_MASK_CLASS == InputType.TYPE_CLASS_NUMBER && input and InputType.TYPE_NUMBER_VARIATION_PASSWORD != 0) return Kind.Password
            val words = listOfNotNull(node.idEntry, node.hint, node.text?.toString(), node.contentDescription?.toString()).joinToString(" ").lowercase()
            return when {
                Regex("otp|2fa|one.?time|verification code|authenticator").containsMatchIn(words) -> Kind.Code
                Regex("pass(word|code)?|pwd|pin").containsMatchIn(words) && node.className?.contains("EditText") == true -> Kind.Password
                Regex("user|login|e-?mail|account|phone").containsMatchIn(words) -> Kind.Username
                node.className?.contains("EditText") == true || input and InputType.TYPE_MASK_CLASS == InputType.TYPE_CLASS_TEXT -> Kind.Text
                else -> Kind.Other
            }
        }
    }
}
