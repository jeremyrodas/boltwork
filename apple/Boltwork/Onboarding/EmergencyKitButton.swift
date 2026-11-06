import SwiftUI

/// Shares a one-page PDF with the Secret Key and where the vault syncs, to print or file away.
/// The PDF is made when this appears and deleted when it goes away, so no copy is left behind.
struct EmergencyKitButton: View {
    let secretKey: String
    var server: String?
    var email: String?
    @State private var pdfURL: URL?

    var body: some View {
        Group {
            if let pdfURL {
                ShareLink(item: pdfURL) {
                    Label("Save or Print Emergency Kit", systemImage: "square.and.arrow.up")
                }
            } else {
                ProgressView()
                    .task { pdfURL = EmergencyKit.render(secretKey: secretKey, server: server, email: email) }
            }
        }
        .onDisappear {
            if let pdfURL { try? FileManager.default.removeItem(at: pdfURL) }
        }
    }
}
