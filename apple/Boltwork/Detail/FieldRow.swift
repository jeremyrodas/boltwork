import BoltworkKit
import SwiftUI

/// One field: label, value (hidden for secrets), and a copy button.
struct FieldRow: View {
    @Environment(AppModel.self) private var model
    @AppStorage(AppSettings.concealPasswords) private var concealByDefault = true
    let field: Field
    let item: Item
    @State private var revealed = false

    private var isSecret: Bool { field.type == .concealed }

    var body: some View {
        if field.type == .totp {
            TOTPRow(label: field.label, secret: field.value)
        } else {
            LabeledContent {
                HStack(spacing: 4) {
                    FieldValue(field: field, hidden: isSecret && concealByDefault && !revealed)
                    if isSecret {
                        Button(revealed ? "Hide" : "Reveal", systemImage: revealed ? "eye.slash" : "eye") { revealed.toggle() }
                            .labelStyle(.iconOnly)
                            .buttonStyle(.borderless)
                            .frame(minWidth: 44, minHeight: 44)
                    }
                    CopyButton(value: field.value, secret: isSecret, label: "Copy \(field.label)") {
                        if field.purpose == .password { model.markUsed(item) }
                    }
                }
            } label: {
                Text(field.label.capitalized(with: .current))
            }
            .onChange(of: item.id) { revealed = false }
        }
    }
}
