import BoltworkKit
import SwiftUI

/// A live one-time code in the detail card, with a countdown ring.
struct DetailCodeRow: View {
    let label: String
    let secret: String

    var body: some View {
        HStack(spacing: 8) {
            VStack(alignment: .leading, spacing: 3) {
                Text(label.lowercased())
                    .font(.caption)
                    .foregroundStyle(Theme.accent)
                if let totp = try? TOTP(secret) {
                    TimelineView(.periodic(from: .now, by: 1)) { context in
                        let code = totp.code(at: context.date)
                        HStack(spacing: 10) {
                            Text(OneTimeCode.grouped(code))
                                .font(.title3.monospacedDigit())
                                .contentTransition(.numericText())
                                .accessibilityLabel(code.map(String.init).joined(separator: " "))
                            CountdownRing(remaining: totp.remaining(at: context.date), period: totp.period)
                            Spacer(minLength: 0)
                            CopyButton(value: code, secret: true, label: "Copy One-Time Code")
                        }
                    }
                } else {
                    Text("Invalid setup key").foregroundStyle(Theme.bad)
                }
            }
        }
        .padding(.leading, 16)
        .padding(.trailing, 6)
        .padding(.vertical, 4)
        .frame(minHeight: 56)
    }
}
