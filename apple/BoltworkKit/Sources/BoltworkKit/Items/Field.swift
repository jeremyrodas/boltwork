public enum FieldType: String, Codable, CaseIterable, Sendable {
    case text, concealed, url, email, phone, date, monthYear, totp, multiline, menu
}

/// What a field means, independent of its label.
public enum FieldPurpose: String, Codable, Sendable {
    case username, password, totp, expiry, notes
}

public struct Field: Codable, Equatable, Hashable, Identifiable, Sendable {
    public var id: String
    public var label: String
    public var type: FieldType
    public var value: String
    public var purpose: FieldPurpose?
    public var options: [String]?

    public init(id: String, label: String, type: FieldType = .text, value: String = "", purpose: FieldPurpose? = nil, options: [String]? = nil) {
        self.id = id
        self.label = label
        self.type = type
        self.value = value
        self.purpose = purpose
        self.options = options
    }
}

public struct Section: Codable, Equatable, Hashable, Identifiable, Sendable {
    public var id: String
    public var title: String
    public var fields: [Field]

    public init(id: String, title: String, fields: [Field]) {
        self.id = id
        self.title = title
        self.fields = fields
    }
}
