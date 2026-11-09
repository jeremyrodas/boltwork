#if os(macOS)
import AppKit
import BoltworkKit

/// Serves the vault's SSH Key items to ssh and git, asking before each use, like the desktop app's agent.
@MainActor
@Observable
final class SSHAgentController {
    private(set) var isRunning = false
    private(set) var error: String?

    @ObservationIgnored weak var model: AppModel?
    @ObservationIgnored private var server: SSHAgentServer?
    @ObservationIgnored private var approvedUntilLock: Set<String> = []
    @ObservationIgnored private var parsed: [String: (updatedAt: Int64, key: SSHKey)] = [:]

    /// In the app's container, which the sandbox lets it serve from, and short enough for a socket path.
    static var socketPath: String { NSHomeDirectory() + "/agent.sock" }

    /// The line that points ssh at this agent.
    static var configLine: String { "IdentityAgent \"\(socketPath.replacing(NSHomeDirectory().components(separatedBy: "/Library/Containers").first ?? "", with: "~"))\"" }

    func setEnabled(_ enabled: Bool) {
        server?.stop()
        server = nil
        isRunning = false
        error = nil
        guard enabled else { return }
        do {
            server = try SSHAgentServer(path: Self.socketPath, backend: Backend(controller: self))
            isRunning = true
        } catch {
            self.error = error.localizedDescription
        }
    }

    /// Forgets "until locked" approvals and parsed keys.
    func locked() {
        approvedUntilLock.removeAll()
        parsed.removeAll()
    }

    /// The vault's SSH keys, with their items.
    var keys: [(item: Item, key: SSHKey)] {
        (model?.items ?? []).compactMap { item in
            guard item.category == .sshKey, item.state == .active,
                  let text = item.content.fields.first(where: { $0.id == "privateKey" })?.value, !text.isEmpty else { return nil }
            if let cached = parsed[item.id], cached.updatedAt == item.updatedAt { return (item, cached.key) }
            guard let key = try? SSHKey(openSSH: text) else { return nil }
            parsed[item.id] = (item.updatedAt, key)
            return (item, key)
        }
    }

    fileprivate func identities() async -> [SSHAgentIdentity] {
        guard await waitForUnlock() else { return [] }
        return keys.map { SSHAgentIdentity(id: $0.item.id, blob: $0.key.publicBlob, comment: $0.item.title) }
    }

    fileprivate func sign(_ identity: SSHAgentIdentity, data: [UInt8], flags: UInt32) async -> [UInt8]? {
        guard await waitForUnlock(), let match = keys.first(where: { $0.item.id == identity.id }), approve(match.item, match.key) else { return nil }
        model?.perform { try $0.markUsed(match.item.id) }
        return try? match.key.sign(data, flags: flags)
    }

    private func waitForUnlock() async -> Bool { await model?.waitForUnlock() ?? false }

    private func approve(_ item: Item, _ key: SSHKey) -> Bool {
        if approvedUntilLock.contains(item.id) { return true }
        NSApp.activate()
        let alert = NSAlert()
        alert.messageText = "Allow an SSH client to use “\(item.title)”?"
        alert.informativeText = "\(key.fingerprint)\n\nA program on this Mac (such as ssh or git) is asking to sign in with this key. Only allow it if you just ran that command."
        alert.addButton(withTitle: "Allow")
        alert.addButton(withTitle: "Allow Until Boltwork Locks")
        alert.addButton(withTitle: "Deny").keyEquivalent = "\u{1b}"
        switch alert.runModal() {
        case .alertFirstButtonReturn: return true
        case .alertSecondButtonReturn: approvedUntilLock.insert(item.id); return true
        default: return false
        }
    }

    private struct Backend: SSHAgentBackend {
        let controller: SSHAgentController
        func identities() async -> [SSHAgentIdentity] { await controller.identities() }
        func sign(_ identity: SSHAgentIdentity, data: [UInt8], flags: UInt32) async -> [UInt8]? {
            await controller.sign(identity, data: data, flags: flags)
        }
    }
}
#endif
