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
    /// A scanned setup code. Its contents are never shown: the screen asks only for the account password.
    @State private var scannedCode: SetupCode?
    @State private var scanning = false

    private var canJoin: Bool {
        guard !password.isEmpty, !isWorking else { return false }
        if let scannedCode, scannedCode.server != nil, scannedCode.email != nil { return true }
        return !server.isEmpty && !email.isEmpty && (scannedCode != nil || !secretKey.isEmpty)
    }

    var body: some View {
        Group {
            if scannedCode != nil { passwordOnly } else { fullForm }
        }
        .formStyle(.grouped)
        .navigationTitle("Join Your Account")
        #if os(iOS)
        .sheet(isPresented: $scanning) {
            SetupCodeScannerSheet { code in
                scannedCode = code
                password = ""
                errorMessage = nil
            }
        }
        #endif
    }

    /// After a scan: only the account password. The server, email and Secret Key stay hidden. A code from a
    /// vault that doesn't sync holds only the Secret Key, so the server and email are still typed.
    private var passwordOnly: some View {
        Form {
            if scannedCode?.server == nil || scannedCode?.email == nil {
                Section("Sync server") {
                    TextField("Server address", text: $server, prompt: Text("sync.example.com or 192.168.1.20:8787"))
                        .textContentType(.URL)
                        .keyboard(.url)
                        .plainTextEntry()
                    TextField("Email", text: $email)
                        .textContentType(.username)
                        .keyboard(.email)
                        .plainTextEntry()
                }
            }
            Section {
                SecureField("Account password", text: $password)
                    .textContentType(.password)
                    .onSubmit(join)
            } header: {
                Label("Setup code scanned", systemImage: "checkmark.circle.fill")
            } footer: {
                Text("Enter your account password to finish. Boltwork keeps the rest of the setup code hidden.")
            }
            errorSection
            joinSection
            Section {
                Button("Start Over") {
                    scannedCode = nil
                    password = ""
                    errorMessage = nil
                }
            }
        }
    }

    private var fullForm: some View {
        Form {
            #if os(iOS)
            if SetupCodeScannerSheet.isSupported {
                Section {
                    Button("Scan Setup Code", systemImage: "qrcode.viewfinder", action: scan)
                } footer: {
                    Text("On a device that’s signed in, open Settings, then Set Up Another Device. After scanning, you only type your account password.")
                }
            }
            #endif
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
            errorSection
            joinSection
        }
    }

    @ViewBuilder private var errorSection: some View {
        if let errorMessage {
            Section {
                Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                    .foregroundStyle(.red)
            }
        }
    }

    private var joinSection: some View {
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

    private func join() {
        guard canJoin else { return }
        isWorking = true
        errorMessage = nil
        Task {
            defer { isWorking = false }
            do {
                if let code = scannedCode {
                    try await model.joinAccount(server: code.server ?? server, email: code.email ?? email.trimmingCharacters(in: .whitespaces),
                                                password: password, secretKey: code.secretKey, backup: code.backup)
                } else {
                    try await model.joinAccount(server: server, email: email.trimmingCharacters(in: .whitespaces), password: password, secretKey: secretKey)
                }
            } catch {
                errorMessage = error.localizedDescription
                if scannedCode != nil { password = "" }
            }
        }
    }

    #if os(iOS)
    private func scan() {
        Task {
            if await SetupCodeScannerSheet.cameraAllowed() {
                scanning = true
            } else {
                errorMessage = "Boltwork needs the camera to scan a setup code. Allow it in Settings, or type the details below."
            }
        }
    }
    #endif
}
