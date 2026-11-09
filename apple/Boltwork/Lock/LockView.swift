import SwiftUI

/// The locked screen: account password, or Face ID / Touch ID when turned on.
struct LockView: View {
    @Environment(AppModel.self) private var model
    @State private var password = ""
    @State private var secretKey = ""
    @State private var isWorking = false
    @State private var errorMessage: String?
    @State private var triedBiometrics = false
    @FocusState private var passwordFocused: Bool

    private var needsSecretKey: Bool { model.storedSecretKey == nil }

    var body: some View {
        VStack(spacing: 20) {
            Spacer()
            Image(.brandMark)
                .resizable()
                .frame(width: 96, height: 96)
                .accessibilityHidden(true)
            Text("Boltwork Is Locked")
                .font(.title.bold())
            VStack(spacing: 12) {
                SecureField("Account password", text: $password)
                    .noAutoFill()
                    .focused($passwordFocused)
                    .onSubmit(unlock)
                if needsSecretKey {
                    TextField("Secret Key", text: $secretKey, prompt: Text("SR1-…"))
                        .font(Theme.monospacedSecret)
                        .plainTextEntry()
                        .onSubmit(unlock)
                }
            }
            .textFieldStyle(.roundedBorder)
            .frame(maxWidth: 360)

            if let errorMessage {
                Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                    .foregroundStyle(.red)
                    .multilineTextAlignment(.center)
            }

            Button(action: unlock) {
                HStack {
                    Text("Unlock")
                    if isWorking { ProgressView().controlSize(.small) }
                }
                .frame(maxWidth: 240)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .keyboardShortcut(.defaultAction)
            .disabled(password.isEmpty || isWorking)

            if model.canQuickUnlock, let name = QuickUnlockInfo.name {
                Button("Unlock with \(name)", systemImage: QuickUnlockInfo.symbol, action: unlockWithBiometrics)
                    .buttonStyle(.bordered)
            }
            Spacer()
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .task {
            #if os(iOS)
            // Face ID looks as soon as the screen shows. On the Mac, Touch ID waits for its button instead of
            // prompting the moment Boltwork locks.
            if model.canQuickUnlock && !triedBiometrics {
                triedBiometrics = true
                unlockWithBiometrics()
                return
            }
            #endif
            passwordFocused = true
        }
    }

    private func unlock() {
        guard !password.isEmpty, !isWorking else { return }
        isWorking = true
        errorMessage = nil
        Task {
            defer { isWorking = false }
            do {
                try await model.unlock(password: password, secretKey: needsSecretKey ? secretKey : nil)
                password = ""
            } catch {
                errorMessage = error.localizedDescription
                password = ""
                passwordFocused = true
            }
        }
    }

    private func unlockWithBiometrics() {
        Task {
            do {
                try await model.unlockWithBiometrics()
            } catch QuickUnlock.Failure.cancelled {
                passwordFocused = true
            } catch {
                errorMessage = error.localizedDescription
                passwordFocused = true
            }
        }
    }
}

/// The device's biometric, for labels.
enum QuickUnlockInfo {
    static var name: String? { QuickUnlock.biometryName }
    static var symbol: String { QuickUnlock.symbolName }
}
