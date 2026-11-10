import BoltworkKit
import CoreImage.CIFilterBuiltins
import SwiftUI

/// Shows a QR code another device scans to join this account. It holds the server address, the email and the
/// Secret Key, so it asks for the account password every time it opens and is gone on leaving.
struct SetupCodeView: View {
    @Environment(AppModel.self) private var model
    @State private var password = ""
    @State private var revealed = false
    @State private var checking = false
    @State private var wrong = false

    var body: some View {
        Form {
            if revealed, let code {
                Section {
                    QRCodeImage(text: code.text)
                        .frame(maxWidth: 280)
                        .frame(maxWidth: .infinity)
                        .accessibilityLabel("Setup code")
                } footer: {
                    Text("On your new phone or tablet, open Boltwork, choose I Already Use Boltwork, then Scan Setup Code. You’ll still type your account password there.")
                }
                Section {
                    LabeledContent("Server", value: code.server ?? "")
                    LabeledContent("Email", value: code.email ?? "")
                } footer: {
                    Text("This code contains your Secret Key. Don’t share it or take a picture of it.")
                }
            } else {
                Section {
                    SecureField("Account password", text: $password)
                        .textContentType(.password)
                        .onSubmit(check)
                    Button("Continue", action: check)
                        .disabled(password.isEmpty || checking)
                } footer: {
                    if wrong {
                        Text("That password isn’t right.").foregroundStyle(.red)
                    } else {
                        Text("Enter your account password to show a setup code for another device.")
                    }
                }
            }
        }
        .formStyle(.grouped)
        .navigationTitle("Set Up Another Device")
        .onDisappear { revealed = false }
    }

    private var code: SetupCode? {
        guard let server = model.sync.serverURL, let email = model.sync.email, let key = model.storedSecretKey else { return nil }
        return SetupCode(server: server, backup: model.sync.backupURL, email: email, secretKey: key)
    }

    private func check() {
        checking = true
        Task {
            defer { checking = false }
            revealed = await model.verifyPassword(password)
            wrong = !revealed
            password = ""
        }
    }
}

/// A QR code on a white card, so it scans in dark mode too.
struct QRCodeImage: View {
    let text: String

    var body: some View {
        if let image = Self.make(text) {
            Image(decorative: image, scale: 1)
                .interpolation(.none)
                .resizable()
                .scaledToFit()
                .padding(16)
                .background(.white, in: .rect(cornerRadius: 12))
        }
    }

    static func make(_ text: String) -> CGImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(text.utf8)
        filter.correctionLevel = "M"
        guard let output = filter.outputImage else { return nil }
        return CIContext().createCGImage(output, from: output.extent)
    }
}
