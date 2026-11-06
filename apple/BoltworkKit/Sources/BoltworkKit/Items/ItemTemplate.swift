/// The fields each kind of item starts with (see `src/core/templates.ts`).
public struct ItemTemplate: Sendable {
    public let category: ItemCategory
    public let name: String
    /// SF Symbol shown for this kind of item.
    public let symbol: String
    public let hasURLs: Bool
    public let fields: [Field]

    public static func `for`(_ category: ItemCategory) -> ItemTemplate {
        all.first { $0.category == category }!
    }

    public static func blankContent(_ category: ItemCategory) -> ItemContent {
        ItemContent(category: category, fields: self.for(category).fields)
    }

    private static let accountTypes = ["Checking", "Savings", "Line of credit", "ATM", "Other"]
    private static let cardTypes = ["Visa", "Mastercard", "American Express", "Discover", "JCB", "Maestro", "UnionPay", "Diners Club", "Other"]
    private static let dbTypes = ["PostgreSQL", "MySQL", "SQL Server", "Oracle", "SQLite", "MongoDB", "Redis", "Other"]

    private static func f(_ id: String, _ label: String, _ type: FieldType = .text, _ purpose: FieldPurpose? = nil, _ options: [String]? = nil) -> Field {
        Field(id: id, label: label, type: type, purpose: purpose, options: options)
    }

    public static let all: [ItemTemplate] = [
        .init(category: .login, name: "Login", symbol: "key.fill", hasURLs: true, fields: [
            f("username", "username", .text, .username),
            f("password", "password", .concealed, .password),
            f("otp", "one-time password", .totp, .totp)
        ]),
        .init(category: .password, name: "Password", symbol: "lock.fill", hasURLs: true, fields: [
            f("password", "password", .concealed, .password)
        ]),
        .init(category: .secureNote, name: "Secure Note", symbol: "note.text", hasURLs: false, fields: []),
        .init(category: .creditCard, name: "Credit Card", symbol: "creditcard.fill", hasURLs: true, fields: [
            f("cardholder", "cardholder name"), f("type", "type", .menu, nil, cardTypes), f("number", "number", .concealed),
            f("cvv", "verification number", .concealed), f("expiry", "expiry date", .monthYear, .expiry),
            f("validFrom", "valid from", .monthYear), f("pin", "PIN", .concealed), f("bank", "issuing bank"),
            f("phone", "customer service phone", .phone)
        ]),
        .init(category: .identity, name: "Identity", symbol: "person.text.rectangle.fill", hasURLs: false, fields: [
            f("firstName", "first name"), f("initial", "initial"), f("lastName", "last name"),
            f("birthDate", "birth date", .date), f("gender", "gender"), f("occupation", "occupation"),
            f("company", "company"), f("department", "department"), f("jobTitle", "job title"),
            f("address", "address", .multiline), f("phone", "phone", .phone), f("email", "email", .email),
            f("website", "website", .url), f("username", "username", .text, .username)
        ]),
        .init(category: .document, name: "Document", symbol: "doc.fill", hasURLs: false, fields: []),
        .init(category: .bankAccount, name: "Bank Account", symbol: "building.columns.fill", hasURLs: true, fields: [
            f("bankName", "bank name"), f("owner", "name on account"), f("accountType", "type", .menu, nil, accountTypes),
            f("routing", "routing number"), f("accountNo", "account number", .concealed), f("swift", "SWIFT"),
            f("iban", "IBAN", .concealed), f("pin", "PIN", .concealed), f("branchPhone", "branch phone", .phone),
            f("branchAddress", "branch address", .multiline)
        ]),
        .init(category: .database, name: "Database", symbol: "cylinder.split.1x2.fill", hasURLs: false, fields: [
            f("dbType", "type", .menu, nil, dbTypes), f("server", "server"), f("port", "port"), f("database", "database"),
            f("username", "username", .text, .username), f("password", "password", .concealed, .password),
            f("sid", "SID"), f("alias", "alias"), f("options", "connection options")
        ]),
        .init(category: .driverLicense, name: "Driver License", symbol: "car.fill", hasURLs: false, fields: [
            f("fullName", "full name"), f("address", "address", .multiline), f("birthDate", "date of birth", .date),
            f("sex", "sex"), f("height", "height"), f("number", "number"), f("class", "license class"),
            f("conditions", "conditions / restrictions"), f("state", "state"), f("country", "country"),
            f("expiry", "expiry date", .date, .expiry)
        ]),
        .init(category: .emailAccount, name: "Email Account", symbol: "envelope.fill", hasURLs: false, fields: [
            f("accountType", "type", .menu, nil, ["IMAP", "POP3", "Exchange", "Other"]),
            f("username", "username", .text, .username), f("server", "server"), f("port", "port number"),
            f("password", "password", .concealed, .password), f("security", "security", .menu, nil, ["None", "SSL", "TLS"]),
            f("smtpServer", "SMTP server"), f("smtpPort", "SMTP port"), f("smtpUsername", "SMTP username"),
            f("smtpPassword", "SMTP password", .concealed), f("provider", "provider"),
            f("providerWebsite", "provider website", .url), f("phone", "support phone", .phone)
        ]),
        .init(category: .membership, name: "Membership", symbol: "ticket.fill", hasURLs: true, fields: [
            f("group", "group"), f("memberName", "member name"), f("memberSince", "member since", .monthYear),
            f("expiry", "expiry date", .monthYear, .expiry), f("memberId", "member ID"), f("pin", "PIN", .concealed),
            f("phone", "telephone", .phone)
        ]),
        .init(category: .outdoorLicense, name: "Outdoor License", symbol: "fish.fill", hasURLs: false, fields: [
            f("fullName", "full name"), f("validFrom", "valid from", .date), f("expiry", "expires", .date, .expiry),
            f("game", "approved wildlife"), f("quota", "maximum quota"), f("state", "state"), f("country", "country")
        ]),
        .init(category: .passport, name: "Passport", symbol: "globe", hasURLs: false, fields: [
            f("type", "type"), f("issuingCountry", "issuing country"), f("number", "number"), f("fullName", "full name"),
            f("sex", "sex"), f("nationality", "nationality"), f("authority", "issuing authority"),
            f("birthDate", "date of birth", .date), f("birthPlace", "place of birth"), f("issued", "issued on", .date),
            f("expiry", "expiry date", .date, .expiry)
        ]),
        .init(category: .rewardProgram, name: "Reward Program", symbol: "gift.fill", hasURLs: true, fields: [
            f("company", "company name"), f("memberName", "member name"), f("memberId", "member ID"),
            f("pin", "PIN", .concealed), f("memberSince", "member since", .monthYear), f("phone", "customer service phone", .phone)
        ]),
        .init(category: .router, name: "Wireless Router", symbol: "wifi.router.fill", hasURLs: false, fields: [
            f("name", "base station name"), f("password", "base station password", .concealed, .password),
            f("server", "server / IP address"), f("networkName", "network name"),
            f("security", "wireless security", .menu, nil, ["WPA3", "WPA2", "WPA", "WEP", "None"]),
            f("wirelessPassword", "wireless network password", .concealed)
        ]),
        .init(category: .server, name: "Server", symbol: "server.rack", hasURLs: true, fields: [
            f("username", "username", .text, .username), f("password", "password", .concealed, .password),
            f("adminUrl", "admin console URL", .url), f("adminUser", "admin console username"),
            f("adminPassword", "admin console password", .concealed), f("host", "hosting provider"),
            f("hostUrl", "hosting provider website", .url), f("supportUrl", "support URL", .url),
            f("supportPhone", "support phone", .phone)
        ]),
        .init(category: .socialSecurityNumber, name: "Social Security Number", symbol: "person.badge.shield.checkmark.fill", hasURLs: false, fields: [
            f("name", "name"), f("number", "number", .concealed)
        ]),
        .init(category: .softwareLicense, name: "Software License", symbol: "opticaldisc.fill", hasURLs: true, fields: [
            f("version", "version"), f("key", "license key", .multiline), f("licensedTo", "licensed to"),
            f("email", "registered email", .email), f("company", "company"), f("publisher", "publisher"),
            f("downloadUrl", "download page", .url), f("price", "retail price"), f("supportEmail", "support email", .email),
            f("purchased", "purchase date", .date), f("orderNumber", "order number"), f("expiry", "expiry date", .date, .expiry)
        ]),
        .init(category: .apiCredential, name: "API Credential", symbol: "puzzlepiece.extension.fill", hasURLs: true, fields: [
            f("username", "username", .text, .username), f("credential", "credential", .concealed, .password),
            f("type", "type"), f("filename", "filename"), f("validFrom", "valid from", .date),
            f("expiry", "expires", .date, .expiry), f("hostname", "hostname")
        ]),
        .init(category: .cryptoWallet, name: "Crypto Wallet", symbol: "bitcoinsign.circle.fill", hasURLs: true, fields: [
            f("recovery", "recovery phrase", .concealed), f("password", "password", .concealed, .password),
            f("address", "wallet address")
        ]),
        .init(category: .sshKey, name: "SSH Key", symbol: "terminal.fill", hasURLs: false, fields: [
            f("publicKey", "public key"), f("fingerprint", "fingerprint"), f("privateKey", "private key", .concealed),
            f("keyType", "key type")
        ]),
        .init(category: .medicalRecord, name: "Medical Record", symbol: "stethoscope", hasURLs: false, fields: [
            f("date", "date", .date), f("location", "location"), f("professional", "healthcare professional"),
            f("patient", "patient"), f("reason", "reason for visit", .multiline), f("medication", "medication"),
            f("dosage", "dosage"), f("medNotes", "medication notes", .multiline)
        ])
    ]
}

extension ItemContent {
    /// The short line shown under an item's title in lists.
    public var subtitle: String {
        func f(_ id: String) -> String { fields.first { $0.id == id }?.value ?? "" }
        switch category {
        case .login, .database, .emailAccount, .server, .apiCredential:
            return f("username").isEmpty ? (urls.first?.url ?? "") : f("username")
        case .creditCard:
            let digits = f("number").filter(\.isNumber)
            if digits.isEmpty { return f("cardholder") }
            return "\(f("type").isEmpty ? "Card" : f("type")) •••• \(digits.suffix(4))"
        case .identity: return [f("firstName"), f("lastName")].filter { !$0.isEmpty }.joined(separator: " ")
        case .bankAccount: return f("bankName")
        case .passport, .driverLicense: return f("fullName")
        case .membership, .rewardProgram: return f("memberName")
        case .secureNote: return String((notes.split(separator: "\n", omittingEmptySubsequences: false).first ?? "").prefix(80))
        case .router: return f("networkName")
        case .softwareLicense: return f("licensedTo").isEmpty ? f("version") : f("licensedTo")
        case .socialSecurityNumber: return f("name")
        case .sshKey: return f("keyType")
        default: return urls.first?.url ?? ""
        }
    }
}
