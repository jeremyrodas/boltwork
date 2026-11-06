import SwiftUI

/// The Secret Key and Emergency Kit. Asks for the account password every time it opens and forgets it on leaving;
/// the Emergency Kit takes a further, confirmed step and is only made then.
struct AccountRecoveryView: View {
    @Environment(AppModel.self) private var model
    @State private var password = ""
    @State private var revealed = false
    @State private var checking = false
    @State private var wrong = false
    @State private var confirmingKit = false
    @State private var showingKit = false

    var body: some View {
        Form {
            if revealed, let key = model.storedSecretKey {
                Section {
                    SecretKeyCard(secretKey: key)
                } footer: {
                    Text("You need your account password and this Secret Key to open your vault on a new device.")
                }
                Section {
                    if showingKit {
                        EmergencyKitButton(secretKey: key, server: model.sync.serverURL, email: model.sync.email)
                    } else {
                        Button("Create Emergency Kit…", systemImage: "doc.badge.plus") { confirmingKit = true }
                    }
                } header: {
                    Text("Emergency Kit")
                } footer: {
                    Text("A PDF with your Secret Key and sync details. Anyone who has it and learns your account password can open your vault.")
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
                        Text("Enter your account password to see your Secret Key.")
                    }
                }
            }
        }
        .formStyle(.grouped)
        .navigationTitle("Secret Key")
        .confirmationDialog("Create an Emergency Kit?", isPresented: $confirmingKit, titleVisibility: .visible) {
            Button("Create Emergency Kit") { showingKit = true }
        } message: {
            Text("Print it or keep it somewhere only you can reach. Don’t email it or keep it with your password.")
        }
        .onDisappear {
            revealed = false
            showingKit = false
        }
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
