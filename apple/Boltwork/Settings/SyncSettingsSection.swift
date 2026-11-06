import BoltworkKit
import SwiftUI

/// Connecting to a sync server, its status, and signing out.
struct SyncSettingsSection: View {
    @Environment(AppModel.self) private var model
    @State private var server = ""
    @State private var email = ""
    @State private var password = ""
    @State private var createAccount = true
    @State private var working = false
    @State private var errorMessage: String?
    @State private var confirmingDisconnect = false

    var body: some View {
        if model.phase == .unlocked {
            switch model.sync.status {
            case .off:
                connectForm
            default:
                statusSection
            }
        }
    }

    private var statusSection: some View {
        Section {
            LabeledContent("Server", value: model.sync.serverURL ?? "")
            LabeledContent("Email", value: model.sync.email ?? "")
            LabeledContent("Status") { SyncStatusText(status: model.sync.status, lastSync: model.sync.lastSyncAt) }
            if model.sync.status == .signedOut {
                SecureField("Account password", text: $password)
                    .textContentType(.password)
                Button("Sign In Again", action: signInAgain)
                    .disabled(password.isEmpty || working)
            } else {
                Button("Sync Now", systemImage: "arrow.triangle.2.circlepath") { Task { await model.sync.syncOnce() } }
                    .disabled(model.sync.status == .syncing)
            }
            Button("Stop Syncing This Device…", role: .destructive) { confirmingDisconnect = true }
                .confirmationDialog("Stop syncing this device?", isPresented: $confirmingDisconnect) {
                    Button("Stop Syncing", role: .destructive) { Task { await model.disconnectSync() } }
                } message: {
                    Text("Your vault stays on this device and on the server. Changes here won’t reach your other devices.")
                }
            if let errorMessage { Text(errorMessage).foregroundStyle(.red) }
        } header: {
            Text("Sync")
        }
    }

    private var connectForm: some View {
        Section {
            TextField("Server address", text: $server, prompt: Text("sync.example.com"))
                .textContentType(.URL)
                .keyboard(.url)
                .plainTextEntry()
            TextField("Email", text: $email)
                .textContentType(.username)
                .keyboard(.email)
                .plainTextEntry()
            SecureField("Account password", text: $password)
                .textContentType(.password)
            Picker("Account", selection: $createAccount) {
                Text("Create a new account").tag(true)
                Text("Sign in to my account").tag(false)
            }
            Button(action: connect) {
                HStack {
                    Text("Turn On Sync")
                    if working { Spacer(); ProgressView() }
                }
            }
            .disabled(server.isEmpty || email.isEmpty || password.isEmpty || working)
            if let errorMessage { Text(errorMessage).foregroundStyle(.red) }
        } header: {
            Text("Sync")
        } footer: {
            Text("Keep this vault the same on all your devices through a Boltwork sync server you run yourself. The server only ever sees encrypted data.")
        }
    }

    private func connect() {
        run { try await model.connectSync(server: server, email: email.trimmingCharacters(in: .whitespaces), password: password, createAccount: createAccount) }
    }

    private func signInAgain() {
        run { try await model.signInToSync(password: password) }
    }

    private func run(_ action: @escaping () async throws -> Void) {
        working = true
        errorMessage = nil
        Task {
            defer {
                working = false
                password = ""
            }
            do { try await action() } catch { errorMessage = error.localizedDescription }
        }
    }
}
