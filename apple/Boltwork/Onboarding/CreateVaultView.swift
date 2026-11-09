import BoltworkKit
import SwiftUI

/// Choosing an account password for a new vault.
struct CreateVaultView: View {
    @Environment(AppModel.self) private var model
    @State private var password = ""
    @State private var confirmation = ""
    @State private var isWorking = false
    @State private var errorMessage: String?

    private var strength: PasswordStrength { PasswordStrength(password) }
    private var canCreate: Bool { password.count >= 8 && password == confirmation && !isWorking }

    var body: some View {
        Form {
            Section {
                SecureField("Account password", text: $password)
                    .textContentType(.newPassword)
                SecureField("Confirm password", text: $confirmation)
                    .textContentType(.newPassword)
                    .onSubmit(create)
                if !password.isEmpty {
                    StrengthMeter(strength: strength)
                }
            } header: {
                Text("Account password")
            } footer: {
                Text("Use at least 8 characters. You’ll type it to unlock Boltwork, so make it memorable. Nobody can reset it for you.")
            }
            if let errorMessage {
                Section {
                    Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                        .foregroundStyle(.red)
                }
            }
            Section {
                Button(action: create) {
                    HStack {
                        Text("Create Vault")
                        if isWorking { Spacer(); ProgressView() }
                    }
                }
                .disabled(!canCreate)
            }
        }
        .formStyle(.grouped)
        .navigationTitle("New Vault")
    }

    private func create() {
        guard canCreate else { return }
        isWorking = true
        errorMessage = nil
        Task {
            defer { isWorking = false }
            do {
                try await model.createVault(password: password)
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }
}
