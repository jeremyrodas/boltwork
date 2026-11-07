import BoltworkKit
import SwiftUI

/// One field in the detail card: a small label above the value. Tapping the row copies the value.
struct DetailFieldRow: View {
    @Environment(AppModel.self) private var model
    @AppStorage(AppSettings.concealPasswords) private var concealByDefault = true
    let field: Field
    let item: Item
    @State private var revealed = false
    @State private var copied = false

    private var isSecret: Bool { field.type == .concealed }

    var body: some View {
        HStack(alignment: .center, spacing: 8) {
            VStack(alignment: .leading, spacing: 3) {
                Text(copied ? "copied" : field.label.lowercased())
                    .font(.caption)
                    .foregroundStyle(Theme.accent)
                    .contentTransition(.opacity)
                FieldValue(field: field, hidden: isSecret && concealByDefault && !revealed)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .contentShape(.rect)
            .onTapGesture(perform: copy)
            if field.purpose == .password {
                StrengthBadge(password: field.value)
            }
            if isSecret {
                Button(revealed ? "Hide" : "Reveal", systemImage: revealed ? "eye.slash" : "eye") { revealed.toggle() }
                    .labelStyle(.iconOnly)
                    .buttonStyle(.borderless)
                    .frame(minWidth: 44, minHeight: 44)
            }
            CopyButton(value: field.value, secret: isSecret, label: "Copy \(field.label)") { used() }
        }
        .padding(.leading, 16)
        .padding(.trailing, 6)
        .padding(.vertical, 4)
        .frame(minHeight: 56)
        .sensoryFeedback(.success, trigger: copied) { _, new in new }
        .task(id: copied) {
            guard copied else { return }
            try? await Task.sleep(for: .seconds(1.5))
            copied = false
        }
        .onChange(of: item.id) { revealed = false }
    }

    private func copy() {
        Clipboard.copy(field.value, secret: isSecret)
        used()
        copied = true
    }

    private func used() {
        if field.purpose == .password { model.markUsed(item) }
    }
}
