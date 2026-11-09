import BoltworkKit
import SwiftUI

/// Setting this device up from an account on a Boltwork sync server.
struct JoinAccountView: View {
    @Environment(AppModel.self) private var model
    @State private var server = ""
    @State private var email = ""
    @State private var password = ""
    @State private var secretKey = ""
    @State private var isWorking = false
    @State private var errorMessage: String?

    private var canJoin: Bool { !server.isEmpty && !email.isEmpty && !password.isEmpty && !secretKey.isEmpty && !isWorking }

    var body: some View {
        Form {
            Section {
                TextField("Server address", text: $server, prompt: Text("sync.example.com or 192.168.1.20:8787"))
                    .textContentType(.URL)
                    .keyboard(.url)
                    .plainTextEntry()
                TextField("Email", text: $email)
                    .textContentType(.username)
                    .keyboard(.email)
                    .plainTextEntry()
            } header: {
                Text("Sync server")
            } footer: {
                Text("The address of the Boltwork sync server your other devices use. Plain http works only on a private network, such as your home network or a VPN.")
            }
            Section("Account") {
                SecureField("Account password", text: $password)
                    .textContentType(.password)
                TextField("Secret Key", text: $secretKey, prompt: Text("SR1-…"))
                    .font(Theme.monospacedSecret)
                    .plainTextEntry()
                    .onSubmit(join)
            }
            if let errorMessage {
                Section {
                    Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                        .foregroundStyle(.red)
                }
            }
            Section {
                Button(action: join) {
                    HStack {
                        Text("Sign In and Download Vault")
                        if isWorking { Spacer(); ProgressView() }
                    }
                }
                .disabled(!canJoin)
            }
        }
        .formStyle(.grouped)
        .navigationTitle("Join Your Account")
    }

    private func join() {
        guard canJoin else { return }
        isWorking = true
        errorMessage = nil
        Task {
            defer { isWorking = false }
            do {
                try await model.joinAccount(server: server, email: email.trimmingCharacters(in: .whitespaces), password: password, secretKey: secretKey)
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }
}
