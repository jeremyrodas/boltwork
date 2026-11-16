package app.boltwork.core

/** The fields each kind of item starts with (see `src/core/templates.ts`). */
class ItemTemplate(val category: ItemCategory, val name: String, val hasUrls: Boolean, val fields: List<Field>) {
    companion object {
        fun of(category: ItemCategory): ItemTemplate = all.first { it.category == category }

        fun blankContent(category: ItemCategory) = ItemContent(category, fields = of(category).fields)

        private val accountTypes = listOf("Checking", "Savings", "Line of credit", "ATM", "Other")
        private val cardTypes = listOf("Visa", "Mastercard", "American Express", "Discover", "JCB", "Maestro", "UnionPay", "Diners Club", "Other")
        private val dbTypes = listOf("PostgreSQL", "MySQL", "SQL Server", "Oracle", "SQLite", "MongoDB", "Redis", "Other")

        private fun f(id: String, label: String, type: FieldType = FieldType.text, purpose: FieldPurpose? = null, options: List<String>? = null) =
            Field(id, label, type, purpose = purpose, options = options)

        val all: List<ItemTemplate> = listOf(
        ItemTemplate(ItemCategory.login, "Login", true, listOf(
                f("username", "username", FieldType.text, FieldPurpose.username),
                f("password", "password", FieldType.concealed, FieldPurpose.password),
                f("otp", "one-time password", FieldType.totp, FieldPurpose.totp),
        )),
        ItemTemplate(ItemCategory.password, "Password", true, listOf(
                f("password", "password", FieldType.concealed, FieldPurpose.password),
        )),
        ItemTemplate(ItemCategory.secureNote, "Secure Note", false, listOf()),
        ItemTemplate(ItemCategory.creditCard, "Credit Card", true, listOf(
                f("cardholder", "cardholder name"), f("type", "type", FieldType.menu, null, cardTypes), f("number", "number", FieldType.concealed),
                f("cvv", "verification number", FieldType.concealed), f("expiry", "expiry date", FieldType.monthYear, FieldPurpose.expiry),
                f("validFrom", "valid from", FieldType.monthYear), f("pin", "PIN", FieldType.concealed), f("bank", "issuing bank"),
                f("phone", "customer service phone", FieldType.phone),
        )),
        ItemTemplate(ItemCategory.identity, "Identity", false, listOf(
                f("firstName", "first name"), f("initial", "initial"), f("lastName", "last name"),
                f("birthDate", "birth date", FieldType.date), f("gender", "gender"), f("occupation", "occupation"),
                f("company", "company"), f("department", "department"), f("jobTitle", "job title"),
                f("address", "address", FieldType.multiline), f("phone", "phone", FieldType.phone), f("email", "email", FieldType.email),
                f("website", "website", FieldType.url), f("username", "username", FieldType.text, FieldPurpose.username),
        )),
        ItemTemplate(ItemCategory.document, "Document", false, listOf()),
        ItemTemplate(ItemCategory.bankAccount, "Bank Account", true, listOf(
                f("bankName", "bank name"), f("owner", "name on account"), f("accountType", "type", FieldType.menu, null, accountTypes),
                f("routing", "routing number"), f("accountNo", "account number", FieldType.concealed), f("swift", "SWIFT"),
                f("iban", "IBAN", FieldType.concealed), f("pin", "PIN", FieldType.concealed), f("branchPhone", "branch phone", FieldType.phone),
                f("branchAddress", "branch address", FieldType.multiline),
        )),
        ItemTemplate(ItemCategory.database, "Database", false, listOf(
                f("dbType", "type", FieldType.menu, null, dbTypes), f("server", "server"), f("port", "port"), f("database", "database"),
                f("username", "username", FieldType.text, FieldPurpose.username), f("password", "password", FieldType.concealed, FieldPurpose.password),
                f("sid", "SID"), f("alias", "alias"), f("options", "connection options"),
        )),
        ItemTemplate(ItemCategory.driverLicense, "Driver License", false, listOf(
                f("fullName", "full name"), f("address", "address", FieldType.multiline), f("birthDate", "date of birth", FieldType.date),
                f("sex", "sex"), f("height", "height"), f("number", "number"), f("class", "license class"),
                f("conditions", "conditions / restrictions"), f("state", "state"), f("country", "country"),
                f("expiry", "expiry date", FieldType.date, FieldPurpose.expiry),
        )),
        ItemTemplate(ItemCategory.emailAccount, "Email Account", false, listOf(
                f("accountType", "type", FieldType.menu, null, listOf("IMAP", "POP3", "Exchange", "Other")),
                f("username", "username", FieldType.text, FieldPurpose.username), f("server", "server"), f("port", "port number"),
                f("password", "password", FieldType.concealed, FieldPurpose.password), f("security", "security", FieldType.menu, null, listOf("None", "SSL", "TLS")),
                f("smtpServer", "SMTP server"), f("smtpPort", "SMTP port"), f("smtpUsername", "SMTP username"),
                f("smtpPassword", "SMTP password", FieldType.concealed), f("provider", "provider"),
                f("providerWebsite", "provider website", FieldType.url), f("phone", "support phone", FieldType.phone),
        )),
        ItemTemplate(ItemCategory.membership, "Membership", true, listOf(
                f("group", "group"), f("memberName", "member name"), f("memberSince", "member since", FieldType.monthYear),
                f("expiry", "expiry date", FieldType.monthYear, FieldPurpose.expiry), f("memberId", "member ID"), f("pin", "PIN", FieldType.concealed),
                f("phone", "telephone", FieldType.phone),
        )),
        ItemTemplate(ItemCategory.outdoorLicense, "Outdoor License", false, listOf(
                f("fullName", "full name"), f("validFrom", "valid from", FieldType.date), f("expiry", "expires", FieldType.date, FieldPurpose.expiry),
                f("game", "approved wildlife"), f("quota", "maximum quota"), f("state", "state"), f("country", "country"),
        )),
        ItemTemplate(ItemCategory.passport, "Passport", false, listOf(
                f("type", "type"), f("issuingCountry", "issuing country"), f("number", "number"), f("fullName", "full name"),
                f("sex", "sex"), f("nationality", "nationality"), f("authority", "issuing authority"),
                f("birthDate", "date of birth", FieldType.date), f("birthPlace", "place of birth"), f("issued", "issued on", FieldType.date),
                f("expiry", "expiry date", FieldType.date, FieldPurpose.expiry),
        )),
        ItemTemplate(ItemCategory.rewardProgram, "Reward Program", true, listOf(
                f("company", "company name"), f("memberName", "member name"), f("memberId", "member ID"),
                f("pin", "PIN", FieldType.concealed), f("memberSince", "member since", FieldType.monthYear), f("phone", "customer service phone", FieldType.phone),
        )),
        ItemTemplate(ItemCategory.router, "Wireless Router", false, listOf(
                f("name", "base station name"), f("password", "base station password", FieldType.concealed, FieldPurpose.password),
                f("server", "server / IP address"), f("networkName", "network name"),
                f("security", "wireless security", FieldType.menu, null, listOf("WPA3", "WPA2", "WPA", "WEP", "None")),
                f("wirelessPassword", "wireless network password", FieldType.concealed),
        )),
        ItemTemplate(ItemCategory.server, "Server", true, listOf(
                f("username", "username", FieldType.text, FieldPurpose.username), f("password", "password", FieldType.concealed, FieldPurpose.password),
                f("adminUrl", "admin console URL", FieldType.url), f("adminUser", "admin console username"),
                f("adminPassword", "admin console password", FieldType.concealed), f("host", "hosting provider"),
                f("hostUrl", "hosting provider website", FieldType.url), f("supportUrl", "support URL", FieldType.url),
                f("supportPhone", "support phone", FieldType.phone),
        )),
        ItemTemplate(ItemCategory.socialSecurityNumber, "Social Security Number", false, listOf(
                f("name", "name"), f("number", "number", FieldType.concealed),
        )),
        ItemTemplate(ItemCategory.softwareLicense, "Software License", true, listOf(
                f("version", "version"), f("key", "license key", FieldType.multiline), f("licensedTo", "licensed to"),
                f("email", "registered email", FieldType.email), f("company", "company"), f("publisher", "publisher"),
                f("downloadUrl", "download page", FieldType.url), f("price", "retail price"), f("supportEmail", "support email", FieldType.email),
                f("purchased", "purchase date", FieldType.date), f("orderNumber", "order number"), f("expiry", "expiry date", FieldType.date, FieldPurpose.expiry),
        )),
        ItemTemplate(ItemCategory.apiCredential, "API Credential", true, listOf(
                f("username", "username", FieldType.text, FieldPurpose.username), f("credential", "credential", FieldType.concealed, FieldPurpose.password),
                f("type", "type"), f("filename", "filename"), f("validFrom", "valid from", FieldType.date),
                f("expiry", "expires", FieldType.date, FieldPurpose.expiry), f("hostname", "hostname"),
        )),
        ItemTemplate(ItemCategory.cryptoWallet, "Crypto Wallet", true, listOf(
                f("recovery", "recovery phrase", FieldType.concealed), f("password", "password", FieldType.concealed, FieldPurpose.password),
                f("address", "wallet address"),
        )),
        ItemTemplate(ItemCategory.sshKey, "SSH Key", false, listOf(
                f("publicKey", "public key"), f("fingerprint", "fingerprint"), f("privateKey", "private key", FieldType.concealed),
                f("keyType", "key type"),
        )),
        ItemTemplate(ItemCategory.medicalRecord, "Medical Record", false, listOf(
                f("date", "date", FieldType.date), f("location", "location"), f("professional", "healthcare professional"),
                f("patient", "patient"), f("reason", "reason for visit", FieldType.multiline), f("medication", "medication"),
                f("dosage", "dosage"), f("medNotes", "medication notes", FieldType.multiline),
        )),
        )
    }
}

/** The short line shown under an item's title in lists. */
val ItemContent.subtitle: String
    get() {
        fun f(id: String) = fields.firstOrNull { it.id == id }?.value ?: ""
        val firstUrl = urls.firstOrNull()?.url ?: ""
        return when (category) {
            ItemCategory.login, ItemCategory.database, ItemCategory.emailAccount, ItemCategory.server, ItemCategory.apiCredential ->
                f("username").ifEmpty { firstUrl }
            ItemCategory.creditCard -> {
                val digits = f("number").filter { it.isDigit() }
                if (digits.isEmpty()) f("cardholder") else "${f("type").ifEmpty { "Card" }} •••• ${digits.takeLast(4)}"
            }
            ItemCategory.identity -> listOf(f("firstName"), f("lastName")).filter { it.isNotEmpty() }.joinToString(" ")
            ItemCategory.bankAccount -> f("bankName")
            ItemCategory.passport, ItemCategory.driverLicense -> f("fullName")
            ItemCategory.membership, ItemCategory.rewardProgram -> f("memberName")
            ItemCategory.secureNote -> notes.substringBefore("\n").take(80)
            ItemCategory.router -> f("networkName")
            ItemCategory.softwareLicense -> f("licensedTo").ifEmpty { f("version") }
            ItemCategory.socialSecurityNumber -> f("name")
            ItemCategory.sshKey -> f("keyType")
            else -> firstUrl
        }
    }

/** Items matching every word of `query` in their title, subtitle, websites, tags or non-secret fields. */
fun List<Item>.search(query: String): List<Item> {
    val words = query.lowercase().split(" ").filter { it.isNotEmpty() }
    if (words.isEmpty()) return this
    return filter { item ->
        val c = item.content
        val text = buildString {
            append(c.title).append('\n').append(c.subtitle).append('\n')
            c.urls.forEach { append(it.url).append('\n') }
            c.tags.forEach { append(it).append('\n') }
            c.allFields.forEach { if (it.type != FieldType.concealed && it.type != FieldType.totp) append(it.value).append('\n') }
            append(c.notes)
        }.lowercase()
        words.all { it in text }
    }
}
