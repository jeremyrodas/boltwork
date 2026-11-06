import BoltworkKit
import SwiftUI

/// A live one-time code with a countdown.
struct TOTPRow: View {
    let label: String
    let secret: String

    var body: some View {
        if let totp = try? TOTP(secret) {
            TimelineView(.periodic(from: .now, by: 1)) { context in
                let code = totp.code(at: context.date)
                let remaining = totp.remaining(at: context.date)
                LabeledContent {
                    HStack(spacing: 8) {
                        Text(Self.grouped(code))
                            .font(.title3.monospacedDigit())
                            .contentTransition(.numericText())
                            .accessibilityLabel(code.map(String.init).joined(separator: " "))
                        Gauge(value: Double(remaining), in: 0...Double(totp.period)) {
                            Text("Seconds left")
                        } currentValueLabel: {
                            Text(remaining, format: .number)
                        }
                        .gaugeStyle(.accessoryCircularCapacity)
                        .tint(remaining <= 5 ? .red : .accentColor)
                        .scaleEffect(0.5)
                        .frame(width: 30, height: 30)
                        CopyButton(value: code, secret: true, label: "Copy One-Time Code")
                    }
                } label: {
                    Text(label.capitalized(with: .current))
                }
            }
        } else {
            LabeledContent(label.capitalized(with: .current)) {
                Text("Invalid setup key").foregroundStyle(.red)
            }
        }
    }

    /// "123456" → "123 456" for reading aloud and typing.
    static func grouped(_ code: String) -> String {
        guard code.count == 6 || code.count == 8 else { return code }
        let mid = code.index(code.startIndex, offsetBy: code.count / 2)
        return "\(code[..<mid]) \(code[mid...])"
    }
}
