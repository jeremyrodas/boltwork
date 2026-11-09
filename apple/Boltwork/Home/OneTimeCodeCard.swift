import BoltworkKit
import SwiftUI

/// One item's current code, its countdown, and tap to copy.
struct OneTimeCodeCard: View {
    @Environment(AppModel.self) private var model
    let item: Item
    @State private var copied = false

    private var totp: TOTP? {
        item.content.allFields.first { $0.type == .totp && !$0.value.isEmpty }.flatMap { try? TOTP($0.value) }
    }

    var body: some View {
        if let totp {
            TimelineView(.periodic(from: .now, by: 1)) { context in
                let code = totp.code(at: context.date)
                Button {
                    Clipboard.copy(code, secret: true)
                    model.markUsed(item)
                    copied = true
                } label: {
                    VStack(alignment: .leading, spacing: 6) {
                        HStack(spacing: 6) {
                            ItemIcon(category: item.category, size: 18)
                            Text(item.title)
                                .font(.footnote.weight(.medium))
                                .lineLimit(1)
                        }
                        Text(copied ? "copied" : "one-time code")
                            .font(.caption)
                            .foregroundStyle(Theme.accent)
                        HStack(spacing: 8) {
                            Text(OneTimeCode.grouped(code))
                                .font(.body.monospacedDigit().weight(.medium))
                                .contentTransition(.numericText())
                            CountdownRing(remaining: totp.remaining(at: context.date), period: totp.period)
                        }
                    }
                    .padding(12)
                    .frame(width: 170, alignment: .leading)
                    .card()
                }
                .buttonStyle(.plain)
                .accessibilityLabel("\(item.title) one-time code \(code.map(String.init).joined(separator: " "))")
                .accessibilityHint("Copies the code")
            }
            .sensoryFeedback(.success, trigger: copied) { _, new in new }
            .task(id: copied) {
                guard copied else { return }
                try? await Task.sleep(for: .seconds(1.5))
                copied = false
            }
        }
    }
}
