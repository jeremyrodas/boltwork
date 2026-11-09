import Foundation

/// JSON settings shared by the vault file and records. Keys stay in declaration order, like `JSON.stringify`.
enum JSONCoding {
    static let decoder = JSONDecoder()

    static func encode<T: Encodable>(_ value: T) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.withoutEscapingSlashes]
        return try encoder.encode(value)
    }
}
