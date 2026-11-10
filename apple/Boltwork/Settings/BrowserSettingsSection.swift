#if os(macOS)
import SwiftUI

/// Connects the Boltwork extension in Chrome, Edge or Brave, and lists the browsers that are connected.
struct BrowserSettingsSection: View {
    @Environment(AppModel.self) private var model
    @AppStorage(AppSettings.browserLink) private var enabled = false
    @State private var guide: ExtensionGuide?
    @State private var installError: String?

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
        Section {
            let browsers = ExtensionInstaller.installed
            if browsers.isEmpty {
                Text("Install Chrome, Edge or Brave to use the Boltwork extension.").foregroundStyle(.secondary)
            }
            ForEach(browsers) { browser in
                Button("Add to \(browser.name)…", systemImage: "puzzlepiece.extension") { add(to: browser) }
            }
            if let installError { Label(installError, systemImage: "exclamationmark.triangle").foregroundStyle(Theme.bad) }
        } header: {
            Text("Add the Extension")
        } footer: {
            Text("Browsers only load an extension you add yourself. Boltwork saves it in a folder you choose and opens your browser’s extensions page. To update it later, add it again to the same folder.")
        }
        .sheet(item: $guide) { ExtensionGuideSheet(guide: $0) }
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

    private func add(to browser: ExtensionInstaller.Browser) {
        installError = nil
        do {
            guard let folder = try ExtensionInstaller.saveCopy() else { return }
            enabled = true
            model.browserLink.setEnabled(true)
            ExtensionInstaller.openExtensionsPage(in: browser)
            guide = ExtensionGuide(browser: browser, folder: folder)
        } catch {
            installError = error.localizedDescription
        }
    }
}

private struct ExtensionGuide: Identifiable {
    let browser: ExtensionInstaller.Browser
    let folder: URL
    var id: String { browser.id }
}

/// The steps left in the browser, next to the page Boltwork just opened.
private struct ExtensionGuideSheet: View {
    let guide: ExtensionGuide
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Finish in \(guide.browser.name)").font(.title2.bold())
            Text("Boltwork saved the extension and opened \(guide.browser.name)’s extensions page. There:")
            VStack(alignment: .leading, spacing: 10) {
                step(1, "Turn on **Developer mode** (top right).")
                step(2, "Click **Load unpacked**.")
                step(3, "Choose the **\(ExtensionInstaller.folderName)** folder in \(guide.folder.deletingLastPathComponent().lastPathComponent).")
                step(4, "Click the Boltwork button in the toolbar (it may be under the puzzle piece), then approve the matching code here.")
            }
            HStack {
                Button("Show Folder") { NSWorkspace.shared.activateFileViewerSelecting([guide.folder]) }
                Button("Open Extensions Page Again") { ExtensionInstaller.openExtensionsPage(in: guide.browser) }
                Spacer()
                Button("Done") { dismiss() }.keyboardShortcut(.defaultAction)
            }
        }
        .padding(24)
        .frame(width: 480)
    }

    private func step(_ n: Int, _ text: LocalizedStringKey) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text("\(n)").font(.callout.bold()).frame(width: 22, height: 22).background(Circle().fill(Theme.accent.opacity(0.2)))
            Text(text)
        }
    }
}
#endif
