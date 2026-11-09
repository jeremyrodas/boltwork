import Foundation

/// Random, memorable and PIN passwords (see `src/core/generator.ts`). Uses the system's secure random source.
public enum PasswordGenerator {
    private static let lower = "abcdefghijklmnopqrstuvwxyz"
    private static let upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    private static let digitChars = "0123456789"
    private static let symbolChars = "!@#$%^&*()-_=+[]{};:,.?/~"
    private static let ambiguous = Set("Il1O0o|`'\"")

    /// The EFF Large Wordlist (CC BY 3.0).
    public static let words: [String] = {
        guard let url = Bundle.module.url(forResource: "wordlist", withExtension: "txt"),
              let text = try? String(contentsOf: url, encoding: .utf8) else { return [] }
        return text.split(separator: "\n").map(String.init)
    }()

    private static func pick(_ s: [Character]) -> Character {
        var rng = SystemRandomNumberGenerator()
        return s.randomElement(using: &rng)!
    }

    public static func generate(_ o: GeneratorOptions = GeneratorOptions()) -> String {
        switch o.mode {
        case .words: return memorable(o)
        case .pin: return String((0..<min(max(o.pinLength, 3), 12)).map { _ in pick(Array(digitChars)) })
        case .characters: return characters(o)
        }
    }

    private static func characters(_ o: GeneratorOptions) -> String {
        func strip(_ s: String) -> [Character] { o.avoidAmbiguous ? s.filter { !ambiguous.contains($0) }.map { $0 } : Array(s) }
        var sets = [strip(lower), strip(upper)]
        if o.digits { sets.append(strip(digitChars)) }
        if o.symbols { sets.append(strip(symbolChars)) }
        let length = max(min(o.length, 100), sets.count)
        // One character from each enabled set, the rest from all of them.
        let all = sets.flatMap { $0 }
        var chars = sets.map(pick)
        while chars.count < length { chars.append(pick(all)) }
        var rng = SystemRandomNumberGenerator()
        chars.shuffle(using: &rng)
        return String(chars)
    }

    private static func syllable() -> String {
        String([pick(Array("bcdfghjklmnpqrstvwxz")), pick(Array("aeiouy")), pick(Array("bcdfghjklmnpqrstvwxz"))])
    }

    private static func memorable(_ o: GeneratorOptions) -> String {
        var rng = SystemRandomNumberGenerator()
        let count = max(3, min(o.wordCount, 15))
        let list = (0..<count).map { _ -> String in
            let w = o.fullWords ? (words.randomElement(using: &rng) ?? syllable()) : syllable() + syllable()
            return o.capitalize ? w.prefix(1).uppercased() + w.dropFirst() : w
        }
        switch o.separator {
        case .digits, .digitsAndSymbols:
            let pool = Array(o.separator == .digits ? digitChars : digitChars + symbolChars)
            return list.dropFirst().reduce(list[0]) { $0 + String(pick(pool)) + $1 }
        case .hyphens: return list.joined(separator: "-")
        case .spaces: return list.joined(separator: " ")
        case .periods: return list.joined(separator: ".")
        case .commas: return list.joined(separator: ",")
        case .underscores: return list.joined(separator: "_")
        }
    }

    /// A username suggestion like "quiet-otter-482".
    public static func suggestUsername() -> String {
        var rng = SystemRandomNumberGenerator()
        let a = words.randomElement(using: &rng) ?? "quiet", b = words.randomElement(using: &rng) ?? "otter"
        return "\(a)-\(b)-\(Int.random(in: 100..<1000, using: &rng))".lowercased()
    }
}
