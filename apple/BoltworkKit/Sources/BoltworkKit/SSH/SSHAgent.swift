#if os(macOS)
import Foundation

/// A key the agent offers, by its vault item.
public struct SSHAgentIdentity: Sendable {
    public let id: String
    public let blob: [UInt8]
    public let comment: String
    public init(id: String, blob: [UInt8], comment: String) {
        self.id = id
        self.blob = blob
        self.comment = comment
    }
}

/// Where the agent's keys come from, and who approves each use.
public protocol SSHAgentBackend: Sendable {
    func identities() async -> [SSHAgentIdentity]
    /// The signature blob, or nil if the user said no.
    func sign(_ identity: SSHAgentIdentity, data: [UInt8], flags: UInt32) async -> [UInt8]?
}

/// A minimal SSH agent (draft-miller-ssh-agent) on a Unix socket: it lists identities and signs. It never
/// accepts keys from clients and never reveals private keys, like the desktop app's (`src/core/sshAgent.ts`).
public final class SSHAgentServer: @unchecked Sendable {
    private static let failure: UInt8 = 5, requestIdentities: UInt8 = 11, identitiesAnswer: UInt8 = 12
    private static let signRequest: UInt8 = 13, signResponse: UInt8 = 14

    public let path: String
    private let listener: UnixSocketListener

    public init(path: String, backend: any SSHAgentBackend) throws {
        self.path = path
        listener = try UnixSocketListener(path: path) { client in
            // One thread per client: it reads a request, waits for the answer (which may wait for the user), replies.
            Thread.detachNewThread {
                defer { close(client) }
                while let header = UnixSocketListener.readExactly(client, 4) {
                    let length = header.reduce(0) { $0 << 8 | Int($1) }
                    guard (1...256 * 1024).contains(length), let message = UnixSocketListener.readExactly(client, length) else { return }
                    let reply = UnixSocketListener.blocking { await SSHAgentServer.reply(to: message, backend: backend) }
                    guard UnixSocketListener.writeAll(client, reply) else { return }
                }
            }
        }
    }

    public func stop() { listener.stop() }

    static func reply(to message: [UInt8], backend: any SSHAgentBackend) async -> [UInt8] {
        var r = SSHWire.Reader(message)
        guard let type = try? r.u8() else { return frame(failure) }
        switch type {
        case requestIdentities:
            let keys = await backend.identities()
            return frame(identitiesAnswer, SSHWire.u32(keys.count) + keys.flatMap { SSHWire.string($0.blob) + SSHWire.string($0.comment) })
        case signRequest:
            guard let blob = try? r.string(), let data = try? r.string() else { return frame(failure) }
            let flags = r.remaining >= 4 ? UInt32((try? r.u32()) ?? 0) : 0
            guard let key = await backend.identities().first(where: { $0.blob == blob }),
                  let signature = await backend.sign(key, data: data, flags: flags) else { return frame(failure) }
            return frame(signResponse, SSHWire.string(signature))
        default:
            // Adding or removing keys, locking and extensions aren't supported: keys live in the vault.
            return frame(failure)
        }
    }

    private static func frame(_ type: UInt8, _ body: [UInt8] = []) -> [UInt8] { SSHWire.u32(body.count + 1) + [type] + body }

}
#endif
