public struct Attachment: Codable, Equatable, Hashable, Identifiable, Sendable {
    public var id: String
    public var name: String
    public var size: Int
    public var mime: String
    public var addedAt: Int64
}
