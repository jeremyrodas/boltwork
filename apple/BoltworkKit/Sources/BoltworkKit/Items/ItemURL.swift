public struct ItemURL: Codable, Equatable, Hashable, Sendable {
    public var label: String
    public var url: String
    public var primary: Bool?

    public init(label: String = "website", url: String, primary: Bool? = nil) {
        self.label = label
        self.url = url
        self.primary = primary
    }
}
