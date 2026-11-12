#if os(macOS)
import AppKit
import SwiftUI

/// Unlocking with the account password for the browser extension or ssh, when Touch ID isn't set up or
/// couldn't unlock: a small panel over whatever is in front, instead of bringing Boltwork's window forward.
@MainActor
final class UnlockPanel: FloatingPanel {
    private static var current: UnlockPanel?

    static func show(for model: AppModel) {
        if let current {
            current.makeKeyAndOrderFront(nil)
            return
        }
        let panel = UnlockPanel()
        current = panel
        panel.present(UnlockPanelView(model: model) { [weak panel] in panel?.dismiss() })
    }

    private func dismiss() {
        if Self.current === self { Self.current = nil }
        close()
    }

    override func cancelOperation(_ sender: Any?) { dismiss() }
}

private struct UnlockPanelView: View {
    let model: AppModel
    let close: () -> Void
    @State private var password = ""
    @State private var isWorking = false
    @State private var errorMessage: String?
    @FocusState private var passwordFocused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                Image(nsImage: NSApp.applicationIconImage).resizable().frame(width: 32, height: 32)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Unlock Boltwork?")
                        .font(.headline)
                    Text("Your vault is locked.").font(.subheadline).foregroundStyle(.secondary)
                }
            }
            SecureField("Account password", text: $password)
                .noAutoFill()
                .textFieldStyle(.roundedBorder)
                .focused($passwordFocused)
                .onSubmit(unlock)
            if let errorMessage {
                Text(errorMessage)
                    .font(.subheadline)
                    .foregroundStyle(.red)
                    .fixedSize(horizontal: false, vertical: true)
            }
            HStack {
                if model.canQuickUnlock, let name = QuickUnlockInfo.name {
                    Button("Use \(name)", systemImage: QuickUnlockInfo.symbol, action: unlockWithBiometrics)
                }
                Spacer()
                Button("Cancel", role: .cancel, action: close)
                    .keyboardShortcut(.cancelAction)
                Button("Unlock", action: unlock)
                    .keyboardShortcut(.defaultAction)
                    .buttonStyle(.borderedProminent)
                    .disabled(password.isEmpty || isWorking)
            }
        }
        .padding(16)
        .frame(width: 380)
        .task {
            passwordFocused = true
        }
        .onChange(of: model.phase) { _, phase in
            if phase == .unlocked { close() }
        }
    }

    private func unlock() {
        guard !password.isEmpty, !isWorking else { return }
        isWorking = true
        errorMessage = nil
        Task {
            defer { isWorking = false }
            do {
                try await model.unlock(password: password)
            } catch {
                errorMessage = error.localizedDescription
                passwordFocused = true
            }
            password = ""
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
#endif
