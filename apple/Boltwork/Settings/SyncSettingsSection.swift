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
    @State private var confirmingDelete = false
    @State private var editingBackup = false
    @State private var backupDraft = ""

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
            LabeledContent("Backup Address", value: model.sync.backupURL ?? "None")
            LabeledContent("Email", value: model.sync.email ?? "")
            LabeledContent("Status") {
                SyncStatusText(status: model.sync.status, lastSync: model.sync.lastSyncAt, usingBackup: model.sync.isUsingBackup)
            }
            if model.sync.status == .signedOut {
                SecureField("Account password", text: $password)
                    .textContentType(.password)
                Button("Sign In Again", action: signInAgain)
                    .disabled(password.isEmpty || working)
            } else {
                Button("Sync Now", systemImage: "arrow.triangle.2.circlepath") { Task { await model.sync.syncOnce() } }
                    .disabled(model.sync.status == .syncing)
            }
            Button(model.sync.backupURL == nil ? "Add Backup Address…" : "Change Backup Address…", systemImage: "point.3.connected.trianglepath.dotted") {
                backupDraft = model.sync.backupURL ?? ""
                editingBackup = true
            }
            .disabled(working)
            .alert("Backup Address", isPresented: $editingBackup) {
                TextField("Address", text: $backupDraft, prompt: Text("100.64.0.5:8787"))
                    .plainTextEntry()
                Button("Save") { saveBackup(backupDraft) }
                if model.sync.backupURL != nil {
                    Button("Remove", role: .destructive) { saveBackup(nil) }
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("Another way to reach the same server, such as a VPN address for when you’re away. Boltwork tries the main address first and uses this one when the main one can’t be reached.")
            }
            Button("Stop Syncing This Device…", role: .destructive) { confirmingDisconnect = true }
                .confirmationDialog("Stop syncing this device?", isPresented: $confirmingDisconnect) {
                    Button("Stop Syncing", role: .destructive) { Task { try? await model.disconnectSync() } }
                } message: {
                    Text("Your vault stays on this device and on the server. Changes here won’t reach your other devices.")
                }
            Button("Delete Account…", role: .destructive) { confirmingDelete = true }
                .disabled(working)
                .confirmationDialog("Delete your sync account?", isPresented: $confirmingDelete) {
                    Button("Delete Account", role: .destructive) { run { try await model.disconnectSync(deleteAccount: true) } }
                } message: {
                    Text("This deletes the account and everything it stores from the server, and can’t be undone. Your vault stays on this device. Your other devices stop syncing.")
                }
            if let errorMessage { Text(errorMessage).foregroundStyle(.red) }
        } header: {
            Text("Sync")
        }
    }

    private var connectForm: some View {
        Section {
            TextField("Server address", text: $server, prompt: Text("sync.example.com"))
                .accessibilityLabel("Server address")
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

    private func saveBackup(_ address: String?) {
        working = true
        errorMessage = nil
        Task {
            defer { working = false }
            do { try await model.setBackupSyncAddress(address) } catch { errorMessage = error.localizedDescription }
        }
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
