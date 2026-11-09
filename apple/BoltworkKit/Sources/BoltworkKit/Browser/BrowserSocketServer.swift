#if os(macOS)
import Foundation

/// The browser link's socket. The native messaging host relays each extension message as a line of JSON,
/// `{id, origin, msg}`, and gets `{id, body}` back, as with the desktop app (`src/main/browserHost.ts`).
public final class BrowserSocketServer: @unchecked Sendable {
    /// The Boltwork extension's ID, from the public key in its manifest (`src/core/extensionId.ts`).
    public static let extensionID = "heephjlhalcgebikhcnialabmojogjih"
    public static var allowedOrigin: String { "chrome-extension://\(extensionID)/" }

    public let path: String
    private let listener: UnixSocketListener

    public init(path: String, handle: @escaping @Sendable (JSONValue, String) async -> JSONValue) throws {
        self.path = path
        listener = try UnixSocketListener(path: path) { client in
            Thread.detachNewThread { Self.serve(client, handle: handle) }
        }
    }

    public func stop() { listener.stop() }

    private static func serve(_ client: Int32, handle: @escaping @Sendable (JSONValue, String) async -> JSONValue) {
        let writer = Writer(fd: client)
        var buffer: [UInt8] = []
        var chunk = [UInt8](repeating: 0, count: 64 * 1024)
        while true {
            let n = chunk.withUnsafeMutableBytes { read(client, $0.baseAddress!, $0.count) }
            if n <= 0 { break }
            buffer += chunk[0..<n]
            if buffer.count > 4 * 1024 * 1024 { break }
            while let newline = buffer.firstIndex(of: 0x0A) {
                let line = Array(buffer[..<newline])
                buffer.removeSubrange(...newline)
                guard let request = try? JSONDecoder().decode(JSONValue.self, from: Data(line)) else { continue }
                let id = request["id"] ?? .null
                let origin = request["origin"]?.stringValue ?? ""
                guard origin == allowedOrigin else {
                    writer.send(["id": id, "body": ["error": "unknown-extension"]])
                    continue
                }
                let msg = request["msg"] ?? .null
                // Requests run side by side: one may wait for the user while another answers at once.
                Task {
                    let body = await handle(msg, origin)
                    writer.send(["id": id, "body": body])
                }
            }
        }
        writer.close()
    }

    private final class Writer: @unchecked Sendable {
        private let fd: Int32
        private let lock = NSLock()
        private var closed = false
        init(fd: Int32) { self.fd = fd }

        func send(_ value: JSONValue) {
            guard let data = try? JSONEncoder().encode(value) else { return }
            lock.withLock {
                guard !closed else { return }
                _ = UnixSocketListener.writeAll(fd, [UInt8](data) + [0x0A])
            }
        }

        /// Closes once the reader is done; replies still pending are dropped, as the host went away.
        func close() {
            lock.withLock {
                closed = true
                Darwin.close(fd)
            }
        }
    }
}
#endif
