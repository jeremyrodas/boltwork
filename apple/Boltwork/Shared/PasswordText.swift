import SwiftUI

/// A password with digits and symbols colored, so it's easy to read back or type.
struct PasswordText: View {
    let password: String

    var body: some View {
        Text(colored)
            .font(.title3.monospaced())
            .accessibilityLabel(password)
    }

    private var colored: AttributedString {
        var out = AttributedString()
        for ch in password {
            var piece = AttributedString(String(ch))
            if ch.isNumber {
                piece.foregroundColor = Theme.digit
            } else if !ch.isLetter && !ch.isWhitespace {
                piece.foregroundColor = Theme.symbol
            }
            out += piece
        }
        return out
    }
}
