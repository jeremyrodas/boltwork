#if os(macOS)
import Foundation

/// Listens on a Unix socket only this user can open, and hands each client's file descriptor to `onClient`
/// (on a background queue). Used by the SSH agent and the browser link.
final class UnixSocketListener: @unchecked Sendable {
    enum Failure: LocalizedError {
        case pathTooLong, inUse, system(String)
        var errorDescription: String? {
            switch self {
            case .pathTooLong: "The socket path is too long."
            case .inUse: "Another app is already using this connection. Quit it and try again."
            case .system(let message): message
            }
        }
    }

    private let source: DispatchSourceRead

    init(path: String, onClient: @escaping @Sendable (Int32) -> Void) throws {
        var address = sockaddr_un()
        address.sun_family = sa_family_t(AF_UNIX)
        let bytes = Array(path.utf8)
        guard bytes.count < MemoryLayout.size(ofValue: address.sun_path) else { throw Failure.pathTooLong }
        withUnsafeMutableBytes(of: &address.sun_path) { $0.copyBytes(from: bytes + [0]) }
        let size = socklen_t(MemoryLayout<sockaddr_un>.size)
        func call(_ fd: Int32, _ f: (Int32, UnsafePointer<sockaddr>, socklen_t) -> Int32) -> Int32 {
            withUnsafePointer(to: &address) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { f(fd, $0, size) } }
        }

        try? FileManager.default.createDirectory(atPath: (path as NSString).deletingLastPathComponent, withIntermediateDirectories: true,
                                                 attributes: [.posixPermissions: 0o700])
        // A socket left by an earlier run: replace it unless something still answers on it.
        if FileManager.default.fileExists(atPath: path) {
            let probe = socket(AF_UNIX, SOCK_STREAM, 0)
            let alive = call(probe, connect) == 0
            close(probe)
            if alive { throw Failure.inUse }
            unlink(path)
        }

        let fd = socket(AF_UNIX, SOCK_STREAM, 0)
        guard fd >= 0 else { throw Failure.system(String(cString: strerror(errno))) }
        guard call(fd, bind) == 0, chmod(path, 0o600) == 0, listen(fd, 16) == 0 else {
            let message = String(cString: strerror(errno))
            close(fd)
            throw Failure.system(message)
        }
        source = DispatchSource.makeReadSource(fileDescriptor: fd, queue: .global())
        source.setEventHandler {
            let client = accept(fd, nil, nil)
            guard client >= 0 else { return }
            var on: Int32 = 1
            setsockopt(client, SOL_SOCKET, SO_NOSIGPIPE, &on, socklen_t(MemoryLayout<Int32>.size))
            onClient(client)
        }
        source.setCancelHandler {
            close(fd)
            unlink(path)
        }
        source.resume()
    }

    deinit { stop() }

    func stop() {
        if !source.isCancelled { source.cancel() }
    }

    static func readExactly(_ fd: Int32, _ count: Int) -> [UInt8]? {
        var buffer = [UInt8](repeating: 0, count: count)
        var done = 0
        while done < count {
            let n = buffer.withUnsafeMutableBytes { read(fd, $0.baseAddress! + done, count - done) }
            if n <= 0 { return nil }
            done += n
        }
        return buffer
    }

    static func writeAll(_ fd: Int32, _ bytes: [UInt8]) -> Bool {
        var done = 0
        while done < bytes.count {
            let n = bytes.withUnsafeBytes { write(fd, $0.baseAddress! + done, bytes.count - done) }
            if n <= 0 { return false }
            done += n
        }
        return true
    }

    /// Runs async work from a client's own thread, which is free to wait for it.
    static func blocking<T: Sendable>(_ work: @escaping @Sendable () async -> T) -> T {
        let box = ResultBox<T>()
        let done = DispatchSemaphore(value: 0)
        Task {
            box.value = await work()
            done.signal()
        }
        done.wait()
        return box.value!
    }
}

private final class ResultBox<T>: @unchecked Sendable { var value: T? }
#endif
