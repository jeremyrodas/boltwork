#if os(macOS)
import AppKit
import BoltworkKit

/// Connects the Boltwork browser extension (Chrome, Edge, Brave) to this app, like the desktop app does:
/// registers the native messaging host with each browser, serves its socket, and asks the user before a
/// browser connects or a passkey is made or used.
@MainActor
@Observable
final class BrowserLinkController: BrowserBridgeHost {
    private(set) var isRunning = false
    private(set) var error: String?
    private(set) var registeredBrowsers: [String] = []
    private(set) var pairings: [BrowserPairing] = []

    @ObservationIgnored weak var model: AppModel?
    @ObservationIgnored private var server: BrowserSocketServer?
    @ObservationIgnored private var lastPrompt: Task<BrowserPasskeyDecision, Never>?
    @ObservationIgnored private lazy var bridge = BrowserBridge(host: self, pairingsFile: URL.applicationSupportDirectory.appending(path: "Boltwork/browser-pairings.json"))

    static let hostName = "com.boltwork.browser"
    /// Each browser's folder under ~/Library/Application Support.
    private static let browsers = [("Chrome", "Google/Chrome"), ("Edge", "Microsoft Edge"), ("Brave", "BraveSoftware/Brave-Browser"), ("Chromium", "Chromium")]

    /// The user's real home folder, outside the app's container.
    private static var home: String { getpwuid(getuid()).map { String(cString: $0.pointee.pw_dir) } ?? NSHomeDirectory() }
    /// In the app's container: the sandbox won't let the app serve a socket anywhere else. The native
    /// messaging host, which runs outside the sandbox, looks here.
    static var socketPath: String { NSHomeDirectory() + "/browser.sock" }

    var store: VaultStore? { model?.openStore }
    var version: String { Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "" }

    func setEnabled(_ enabled: Bool) {
        server?.stop()
        server = nil
        isRunning = false
        error = nil
        pairings = bridge.pairings.all
        guard enabled else { return }
        do {
            let bridge = bridge
            server = try BrowserSocketServer(path: Self.socketPath) { msg, origin in await bridge.handle(msg, origin: origin) }
            isRunning = true
            registerNativeHost()
        } catch {
            self.error = error.localizedDescription
        }
    }

    func revoke(_ pairing: BrowserPairing) {
        bridge.pairings.revoke(id: pairing.id)
        pairings = bridge.pairings.all
    }

    /// Tells each installed browser where the host is. Browsers that aren't installed are skipped.
    private func registerNativeHost() {
        guard let host = Bundle.main.url(forAuxiliaryExecutable: "boltwork-browser-host") else {
            error = "This build of Boltwork is missing its browser connector."
            return
        }
        let manifest: [String: Any] = [
            "name": Self.hostName, "description": "Boltwork browser extension connector", "path": host.path, "type": "stdio",
            "allowed_origins": [BrowserSocketServer.allowedOrigin],
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: manifest, options: [.prettyPrinted, .withoutEscapingSlashes]) else { return }
        registeredBrowsers = Self.browsers.compactMap { name, folder in
            let dir = URL(filePath: Self.home).appending(path: "Library/Application Support/\(folder)/NativeMessagingHosts")
            // Creating only the last folder fails when the browser isn't installed.
            try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: false)
            return (try? data.write(to: dir.appending(path: "\(Self.hostName).json"))) == nil ? nil : name
        }
    }

    // MARK: - BrowserBridgeHost

    func approvePairing(code: String, name: String, origin: String) async -> Bool {
        NSApp.activate()
        let alert = NSAlert()
        alert.messageText = "Connect “\(name)” to Boltwork?"
        alert.informativeText = "Only connect if your browser shows the code \(code). The browser can then fill your logins and passkeys on matching websites."
        alert.addButton(withTitle: "Connect")
        alert.addButton(withTitle: "Don’t Connect").keyEquivalent = "\u{1b}"
        let allowed = alert.runModal() == .alertFirstButtonReturn
        if allowed { pairings = bridge.pairings.all }
        return allowed
    }

    func approvePasskey(_ prompt: BrowserPasskeyPrompt) async -> BrowserPasskeyDecision {
        // One prompt at a time: a second request waits for the first answer.
        let earlier = lastPrompt
        let ask = Task {
            _ = await earlier?.value
            return await PasskeyPromptPanel.ask(prompt)
        }
        lastPrompt = ask
        return await ask.value
    }

    func waitForUnlock() async -> Bool { await model?.waitForUnlock() ?? false }

    func showMain(route: String?) {
        if let model, model.phase != .unlocked { model.askToUnlock() } else { NSApp.activate() }
    }

    func changed() { model?.storeChanged() }
}
#endif
