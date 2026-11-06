public enum GeneratorMode: String, Codable, CaseIterable, Sendable {
    case characters, words, pin
}

public enum WordSeparator: String, Codable, CaseIterable, Sendable {
    case hyphens, spaces, periods, commas, underscores, digits, digitsAndSymbols
}

/// Same shape and defaults as the desktop app's generator settings.
public struct GeneratorOptions: Codable, Equatable, Sendable {
    public var mode: GeneratorMode = .characters
    public var length = 20
    public var digits = true
    public var symbols = true
    public var avoidAmbiguous = false
    public var wordCount = 4
    public var separator: WordSeparator = .hyphens
    public var capitalize = true
    public var fullWords = true
    public var pinLength = 6

    public init() {}
}
