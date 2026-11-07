#if os(macOS)
import SwiftUI

/// Connects the Boltwork extension in Chrome, Edge or Brave, and lists the browsers that are connected.
struct BrowserSettingsSection: View {
    @Environment(AppModel.self) private var model
    @AppStorage(AppSettings.browserLink) private var enabled = false

    var body: some View {
        let link = model.browserLink
        Section {
            Toggle("Connect to the Boltwork browser extension", isOn: $enabled)
                .onChange(of: enabled) { _, on in link.setEnabled(on) }
            if let error = link.error {
                Label(error, systemImage: "exclamationmark.triangle").foregroundStyle(Theme.bad)
            } else if enabled, !link.registeredBrowsers.isEmpty {
                LabeledContent("Ready for", value: link.registeredBrowsers.formatted(.list(type: .and)))
            }
        } footer: {
            Text("Fill logins and passkeys in Chrome, Edge and Brave. Boltwork asks before a browser connects.")
        }
        if enabled {
            Section("Connected Browsers") {
                if link.pairings.isEmpty {
                    Text("Open the Boltwork extension in your browser to connect it.").foregroundStyle(.secondary)
                }
                ForEach(link.pairings) { pairing in
                    LabeledContent {
                        Button("Disconnect", role: .destructive) { link.revoke(pairing) }
                    } label: {
                        Text(pairing.name)
                        Text("Connected \(Date(timeIntervalSince1970: TimeInterval(pairing.createdAt) / 1000).formatted(date: .abbreviated, time: .omitted))")
                    }
                }
            }
        }
    }
}
#endif
