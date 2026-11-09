/// The part of an item that's kept in its history: everything the user edits.
public struct ItemContent: Codable, Equatable, Hashable, Sendable {
    public var category: ItemCategory
    public var title: String
    public var urls: [ItemURL]
    public var fields: [Field]
    public var sections: [Section]
    public var notes: String
    public var tags: [String]
    public var icon: String?
    public var autosubmit: Bool?

    public init(category: ItemCategory, title: String = "", urls: [ItemURL] = [], fields: [Field] = [], sections: [Section] = [],
                notes: String = "", tags: [String] = [], icon: String? = nil, autosubmit: Bool? = nil) {
        self.category = category
        self.title = title
        self.urls = urls
        self.fields = fields
        self.sections = sections
        self.notes = notes
        self.tags = tags
        self.icon = icon
        self.autosubmit = autosubmit
    }

    /// All fields, primary first, then section fields.
    public var allFields: [Field] { fields + sections.flatMap(\.fields) }

    public func field(for purpose: FieldPurpose) -> Field? {
        allFields.first { $0.purpose == purpose && !$0.value.isEmpty }
    }
}

public struct ItemVersion: Codable, Equatable, Hashable, Sendable {
    public var savedAt: Int64
    public var content: ItemContent
}
