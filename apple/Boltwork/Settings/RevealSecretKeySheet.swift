import SwiftUI

/// Asks for the account password, then shows the Secret Key and Emergency Kit.
struct RevealSecretKeySheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var password = ""
    @State private var revealed = false
    @State private var checking = false
    @State private var wrong = false

    var body: some View {
        NavigationStack {
            Form {
                if revealed, let key = model.storedSecretKey {
                    Section {
                        SecretKeyCard(secretKey: key)
                    }
                    Section {
                        EmergencyKitButton(secretKey: key, server: model.sync.serverURL, email: model.sync.email)
                    }
                } else {
                    Section {
                        SecureField("Account password", text: $password)
                            .textContentType(.password)
                            .onSubmit(check)
                        Button("Continue", action: check)
                            .disabled(password.isEmpty || checking)
                    } footer: {
                        if wrong { Text("That password isn’t right.").foregroundStyle(.red) }
                    }
                }
            }
            .formStyle(.grouped)
            .navigationTitle("Secret Key")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
        }
        #if os(macOS)
        .frame(minWidth: 420, minHeight: 300)
        #endif
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
