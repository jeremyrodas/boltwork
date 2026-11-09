import BoltworkKit
import SwiftUI

/// "Very Good" with a colored ring, next to a saved password.
struct StrengthBadge: View {
    let password: String

    var body: some View {
        let strength = PasswordStrength(password)
        HStack(spacing: 6) {
            Text(strength.label)
                .font(.footnote)
                .foregroundStyle(.secondary)
            Circle()
                .strokeBorder(Self.color(strength.level), lineWidth: 2.5)
                .frame(width: 14, height: 14)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Strength: \(strength.label)")
    }

    static func color(_ level: Int) -> Color {
        switch level {
        case 0...2: Theme.bad
        case 3: .orange
        case 4: Theme.warn
        default: Theme.good
        }
    }
}
