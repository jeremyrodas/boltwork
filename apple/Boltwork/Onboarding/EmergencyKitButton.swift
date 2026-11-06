import SwiftUI

/// Shares a one-page PDF with the Secret Key and where the vault syncs, to print or file away.
struct EmergencyKitButton: View {
    let secretKey: String
    var server: String?
    var email: String?
    @State private var pdfURL: URL?

    var body: some View {
        if let pdfURL {
            ShareLink(item: pdfURL) {
                Label("Save or Print Emergency Kit", systemImage: "square.and.arrow.up")
            }
        } else {
            ProgressView()
                .task { pdfURL = EmergencyKit.render(secretKey: secretKey, server: server, email: email) }
        }
    }
}
