import SwiftUI

/// The Secret Key in large monospaced type, with a copy button.
struct SecretKeyCard: View {
    let secretKey: String

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(secretKey)
                .font(.title3.monospaced())
                .textSelection(.enabled)
                .minimumScaleFactor(0.6)
                .lineLimit(2)
                .accessibilityLabel("Secret Key: \(secretKey.map(String.init).joined(separator: " "))")
            Button("Copy Secret Key", systemImage: "doc.on.doc") {
                Clipboard.copy(secretKey, secret: true)
            }
            .buttonStyle(.bordered)
        }
        .padding(.vertical, 4)
    }
}
