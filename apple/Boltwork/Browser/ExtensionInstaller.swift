#if os(macOS)
import AppKit

/// Hands the bundled browser extension to Chrome, Edge, Brave or Chromium. Browsers only load an extension the
/// person adds themselves, so this saves a copy where they choose and opens the browser's extensions page.
enum ExtensionInstaller {
    struct Browser: Identifiable, Hashable {
        let id: String
        let name: String
        let extensionsPage: String
        var appURL: URL? { NSWorkspace.shared.urlForApplication(withBundleIdentifier: id) }
    }

    static let browsers = [
        Browser(id: "com.google.Chrome", name: "Chrome", extensionsPage: "chrome://extensions"),
        Browser(id: "com.brave.Browser", name: "Brave", extensionsPage: "brave://extensions"),
        Browser(id: "com.microsoft.edgemac", name: "Edge", extensionsPage: "edge://extensions"),
        Browser(id: "org.chromium.Chromium", name: "Chromium", extensionsPage: "chrome://extensions"),
    ]

    static var installed: [Browser] { browsers.filter { $0.appURL != nil } }

    static var bundled: URL? { Bundle.main.url(forResource: "dist-extension", withExtension: nil) }

    /// Asks where to keep the extension and copies it there, replacing an older copy. Returns the folder.
    @MainActor
    static func saveCopy() throws -> URL? {
        guard let bundled else { throw CocoaError(.fileNoSuchFile, userInfo: [NSLocalizedDescriptionKey: "This build of Boltwork doesn’t include the browser extension."]) }
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.canCreateDirectories = true
        panel.prompt = "Save Here"
        panel.message = "Choose where to keep the Boltwork extension. Your browser loads it from this folder, so leave it there."
        let home = getpwuid(getuid()).map { String(cString: $0.pointee.pw_dir) } ?? NSHomeDirectory()
        panel.directoryURL = URL(filePath: home).appending(path: "Documents")
        guard panel.runModal() == .OK, let folder = panel.url else { return nil }
        let destination = folder.lastPathComponent == folderName ? folder : folder.appending(path: folderName)
        let fm = FileManager.default
        if fm.fileExists(atPath: destination.path) { try fm.removeItem(at: destination) }
        try fm.copyItem(at: bundled, to: destination)
        return destination
    }

    static let folderName = "Boltwork Extension"

    static func openExtensionsPage(in browser: Browser) {
        guard let app = browser.appURL, let page = URL(string: browser.extensionsPage) else { return }
        NSWorkspace.shared.open([page], withApplicationAt: app, configuration: NSWorkspace.OpenConfiguration())
    }
}
#endif
