import SwiftUI

/// Shows a new account's Secret Key so the user can save it.
struct SecretKeySheet: View {
    let secretKey: String
    @Environment(\.dismiss) private var dismiss
    @State private var savedIt = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    SecretKeyCard(secretKey: secretKey)
                } footer: {
                    Text("You need your account password and this Secret Key to open your vault on a new device. Boltwork can’t recover either one. Save the Emergency Kit somewhere safe, like a password-protected drive or a printout.")
                }
                Section {
                    EmergencyKitButton(secretKey: secretKey)
                    Toggle("I saved my Secret Key", isOn: $savedIt)
                }
            }
            .formStyle(.grouped)
            .navigationTitle("Your Secret Key")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                        .disabled(!savedIt)
                }
            }
        }
    }
}

#Preview {
    SecretKeySheet(secretKey: "SR1-ABCDEF-GHJKM-NPQRS-TVWXY-Z0123")
}
