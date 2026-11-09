#if os(macOS)
import SwiftUI

/// Turns on the SSH agent and shows how to point ssh at it.
struct SSHAgentSettingsSection: View {
    @Environment(AppModel.self) private var model
    @AppStorage(AppSettings.sshAgent) private var enabled = false

    var body: some View {
        Section {
            Toggle("Use Boltwork as your SSH agent", isOn: $enabled)
                .onChange(of: enabled) { _, on in model.sshAgent.setEnabled(on) }
            if let error = model.sshAgent.error {
                Label(error, systemImage: "exclamationmark.triangle").foregroundStyle(Theme.bad)
            }
        } footer: {
            Text("ssh and git can sign in with the SSH keys in your vault. Boltwork asks before each use.")
        }
        if enabled {
            Section {
                LabeledContent("Add this to ~/.ssh/config under Host *") {
                    HStack {
                        Text(SSHAgentController.configLine).font(.callout.monospaced()).textSelection(.enabled)
                        CopyButton(value: SSHAgentController.configLine)
                    }
                }
            } header: {
                Text("Setup")
            }
            Section("Keys") {
                let keys = model.sshAgent.keys
                if keys.isEmpty {
                    Text("Add an SSH Key item to your vault to use it here.").foregroundStyle(.secondary)
                }
                ForEach(keys, id: \.item.id) { entry in
                    LabeledContent(entry.item.title) {
                        Text("\(entry.key.typeName) · \(entry.key.fingerprint)").font(.caption.monospaced()).textSelection(.enabled)
                    }
                }
            }
        }
    }
}
#endif
