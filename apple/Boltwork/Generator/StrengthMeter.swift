import BoltworkKit
import SwiftUI

/// A bar and label for how hard a password is to guess.
struct StrengthMeter: View {
    let strength: PasswordStrength

    private var color: Color {
        switch strength.level {
        case 0...2: .red
        case 3: .orange
        case 4: .yellow
        default: .green
        }
    }

    var body: some View {
        HStack {
            ProgressView(value: Double(strength.level), total: 7)
                .tint(color)
            Text(strength.label)
                .font(.footnote)
                .foregroundStyle(.secondary)
                .frame(minWidth: 70, alignment: .trailing)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Password strength: \(strength.label)")
    }
}
