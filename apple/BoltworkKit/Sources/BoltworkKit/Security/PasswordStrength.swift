import Foundation

/// A password strength estimate on the desktop app's 0–7 scale.
///
/// The desktop app uses zxcvbn. This is a lighter estimate: it measures the character pool and length,
/// then discounts repeats, sequences, keyboard runs and common passwords and words, so results are close but not identical.
public struct PasswordStrength: Equatable, Sendable {
    public static let labels = ["None", "Terrible", "Weak", "Fair", "Good", "Very Good", "Excellent", "Fantastic"]
    private static let thresholds: [Double] = [4, 6, 8, 10, 12, 14]

    public let level: Int
    public let guessesLog10: Double
    public var label: String { Self.labels[level] }
    /// Watchtower treats Terrible, Weak and Fair as weak.
    public var isWeak: Bool { level <= 3 }

    public init(_ password: String) {
        guard !password.isEmpty else { level = 0; guessesLog10 = 0; return }
        let g = Self.estimateGuessesLog10(String(password.prefix(200)))
        guessesLog10 = (g * 10).rounded() / 10
        level = (Self.thresholds.firstIndex { g < $0 } ?? 6) + 1
    }

    private static let common: Set<String> = [
        "password", "123456", "12345678", "qwerty", "abc123", "monkey", "letmein", "dragon", "111111", "baseball",
        "iloveyou", "trustno1", "sunshine", "master", "welcome", "shadow", "ashley", "football", "jesus", "michael",
        "ninja", "mustang", "password1", "admin", "login", "princess", "starwars", "hello", "freedom", "whatever",
        "qazwsx", "superman", "batman", "secret", "hunter", "hunter2", "changeme", "passw0rd", "p@ssword", "summer", "winter"
    ]
    private static let keyboardRows = ["qwertyuiop", "asdfghjkl", "zxcvbnm", "1234567890", "!@#$%^&*()"]

    static func estimateGuessesLog10(_ pw: String) -> Double {
        let lowered = pw.lowercased()
        if common.contains(lowered) || common.contains(lowered.trimmingCharacters(in: .decimalDigits)) { return 1 }

        var pool = 0
        if pw.contains(where: \.isLowercase) { pool += 26 }
        if pw.contains(where: \.isUppercase) { pool += 26 }
        if pw.contains(where: \.isNumber) { pool += 10 }
        if pw.contains(where: { !$0.isLetter && !$0.isNumber && $0.isASCII }) { pool += 33 }
        if pw.contains(where: { !$0.isASCII }) { pool += 100 }

        // Count "effective" characters: runs, sequences and keyboard walks add little.
        let chars = Array(lowered)
        var effective = 0.0
        for i in chars.indices {
            if i == 0 { effective += 1; continue }
            let a = chars[i - 1], b = chars[i]
            let sequential = a.asciiValue.flatMap { x in b.asciiValue.map { y in abs(Int(x) - Int(y)) == 1 } } ?? false
            let keyboard = keyboardRows.contains { $0.contains(String([a, b])) || $0.contains(String([b, a])) }
            effective += (a == b || sequential || keyboard) ? 0.2 : 1
        }

        // Words from the wordlist count as one "symbol" from a 7776-word pool rather than many letters.
        var log10 = effective * log10Of(Double(max(pool, 10)))
        let parts = lowered.split { !$0.isLetter }.map(String.init)
        let dictionaryHits = parts.filter { $0.count >= 3 && wordSet.contains($0) }
        if !dictionaryHits.isEmpty {
            let wordChars = dictionaryHits.reduce(0) { $0 + $1.count }
            let rest = max(0, effective - Double(wordChars))
            let asWords = Double(dictionaryHits.count) * log10Of(7776) + rest * log10Of(Double(max(pool, 10)))
            log10 = min(log10, asWords + 0.5)
        }
        return max(0, log10 - 0.3)
    }

    private static func log10Of(_ x: Double) -> Double { Foundation.log10(x) }

    private static let wordSet = Set(PasswordGenerator.words)
}
