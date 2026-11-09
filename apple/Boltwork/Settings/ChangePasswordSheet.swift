import BoltworkKit
import SwiftUI

struct ChangePasswordSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var current = ""
    @State private var new = ""
    @State private var confirmation = ""
    @State private var working = false
    @State private var errorMessage: String?

    private var canSave: Bool { !current.isEmpty && new.count >= 8 && new == confirmation && !working }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    SecureField("Current password", text: $current)
                        .textContentType(.password)
                }
                Section {
                    SecureField("New password", text: $new)
                        .textContentType(.newPassword)
                    SecureField("Confirm new password", text: $confirmation)
                        .textContentType(.newPassword)
                    if !new.isEmpty { StrengthMeter(strength: PasswordStrength(new)) }
                } footer: {
                    Text("Your Secret Key stays the same. If you sync, your other devices will ask for the new password.")
                }
                if let errorMessage {
                    Section { Label(errorMessage, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.red) }
                }
            }
            .formStyle(.grouped)
            .navigationTitle("Change Password")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Change", action: change).disabled(!canSave)
                }
            }
        }
        #if os(macOS)
        .frame(minWidth: 420, minHeight: 340)
        #endif
    }

    private func change() {
        working = true
        errorMessage = nil
        Task {
            defer { working = false }
            do {
                try await model.changePassword(current: current, new: new)
                dismiss()
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }
}
