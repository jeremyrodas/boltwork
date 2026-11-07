/// Formatting for one-time codes.
enum OneTimeCode {
    /// "123456" → "123 · 456", easier to read and type.
    static func grouped(_ code: String) -> String {
        guard code.count == 6 || code.count == 8 else { return code }
        let mid = code.index(code.startIndex, offsetBy: code.count / 2)
        return "\(code[..<mid]) · \(code[mid...])"
    }
}
