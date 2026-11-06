import SwiftUI

/// A copy button that briefly shows a checkmark.
struct CopyButton: View {
    let value: String
    var secret = false
    var label = "Copy"
    var onCopy: (() -> Void)?
    @State private var copied = false

    var body: some View {
        Button(label, systemImage: copied ? "checkmark" : "doc.on.doc", action: copy)
            .labelStyle(.iconOnly)
            .buttonStyle(.borderless)
            .contentTransition(.symbolEffect(.replace))
            .sensoryFeedback(.success, trigger: copied) { _, new in new }
            .frame(minWidth: 44, minHeight: 44)
            .task(id: copied) {
                guard copied else { return }
                try? await Task.sleep(for: .seconds(1.5))
                copied = false
            }
    }

    private func copy() {
        Clipboard.copy(value, secret: secret)
        onCopy?()
        copied = true
    }
}
