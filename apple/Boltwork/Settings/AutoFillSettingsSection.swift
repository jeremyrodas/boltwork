import AuthenticationServices
import SwiftUI

/// Turns on Boltwork as the system's password and passkey provider.
struct AutoFillSettingsSection: View {
    @Environment(AppModel.self) private var model
    @Environment(\.scenePhase) private var scenePhase
    @State private var enabled = false

    var body: some View {
        Section {
            if enabled {
                Label("AutoFill is on", systemImage: "checkmark.circle.fill")
            } else {
                Button("Turn On AutoFill…", action: turnOn)
            }
        } header: {
            Text("AutoFill")
        } footer: {
            Text(footer)
        }
        .task(id: scenePhase) { enabled = await CredentialIdentities.isEnabled }
    }

    private var footer: String {
        guard SharedContainer.isAvailable else { return "AutoFill needs a build of Boltwork signed with a developer team." }
        let name = QuickUnlock.hardwareName ?? "Face ID or Touch ID"
        let unlock = model.isQuickUnlockEnabled ? "" : " Turn on \(name) unlock to use it."
        return "Fill passwords and passkeys in apps and websites. AutoFill opens your vault with \(name).\(unlock)"
    }

    private func turnOn() {
        Task {
            if (try? await ASSettingsHelper.requestToTurnOnCredentialProviderExtension()) == true {
                enabled = true
                model.updateAutoFill()
            } else {
                try? await ASSettingsHelper.openCredentialProviderAppSettings()
            }
        }
    }
}
