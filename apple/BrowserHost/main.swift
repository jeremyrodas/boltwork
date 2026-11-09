// Boltwork's native messaging host. Chrome, Edge and Brave start it when the Boltwork extension connects and
// talk to it with 4-byte length-prefixed JSON on stdin and stdout. It relays each message to the running
// app's socket as a line of JSON tagged with the extension origin the browser passed, and relays the replies.
// Same protocol as the desktop app's host (`src/nmhost/nmhost.ts`).
import Foundation

let origin = CommandLine.arguments.first { $0.hasPrefix("chrome-extension://") } ?? ""
// The app serves its socket from its sandbox container.
let socketPath = ProcessInfo.processInfo.environment["BOLTWORK_BROWSER_SOCK"]
    ?? NSHomeDirectory() + "/Library/Containers/app.boltwork.apple/Data/browser.sock"
let stdoutLock = NSLock()
let connectionLock = NSLock()
nonisolated(unsafe) var connection: Int32 = -1

/// Writes one message to the browser.
func send(_ json: Data) {
    var body = json
    if body.count > 1024 * 1024 {
        let id = (try? JSONSerialization.jsonObject(with: json) as? [String: Any])?["id"] ?? NSNull()
        body = (try? JSONSerialization.data(withJSONObject: ["id": id, "body": ["error": "too-large"]])) ?? Data()
    }
    var length = UInt32(body.count).littleEndian
    stdoutLock.withLock {
        FileHandle.standardOutput.write(Data(bytes: &length, count: 4) + body)
    }
}

/// Connects to the app, starting a thread that relays its replies. -1 if it isn't running.
func connectToApp() -> Int32 {
    connectionLock.withLock {
        if connection >= 0 { return connection }
        var address = sockaddr_un()
        address.sun_family = sa_family_t(AF_UNIX)
        let path = Array(socketPath.utf8)
        guard path.count < MemoryLayout.size(ofValue: address.sun_path) else { return -1 }
        withUnsafeMutableBytes(of: &address.sun_path) { $0.copyBytes(from: path + [0]) }
        let fd = socket(AF_UNIX, SOCK_STREAM, 0)
        let ok = withUnsafePointer(to: &address) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { connect(fd, $0, socklen_t(MemoryLayout<sockaddr_un>.size)) }
        } == 0
        guard ok else { close(fd); return -1 }
        var on: Int32 = 1
        setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &on, socklen_t(MemoryLayout<Int32>.size))
        connection = fd
        Thread.detachNewThread { relayReplies(fd) }
        return fd
    }
}

func relayReplies(_ fd: Int32) {
    var buffer = Data()
    var chunk = [UInt8](repeating: 0, count: 64 * 1024)
    while true {
        let n = chunk.withUnsafeMutableBytes { read(fd, $0.baseAddress!, $0.count) }
        if n <= 0 { break }
        buffer.append(contentsOf: chunk[0..<n])
        while let newline = buffer.firstIndex(of: 0x0A) {
            let line = buffer[buffer.startIndex..<newline]
            buffer.removeSubrange(buffer.startIndex...newline)
            if (try? JSONSerialization.jsonObject(with: line)) != nil { send(Data(line)) }
        }
    }
    connectionLock.withLock {
        if connection == fd { connection = -1 }
        close(fd)
    }
}

func relay(_ message: [String: Any]) {
    let id = message["id"] ?? NSNull()
    let fd = connectToApp()
    guard fd >= 0, let line = try? JSONSerialization.data(withJSONObject: ["id": id, "origin": origin, "msg": message["msg"] ?? NSNull()]) else {
        send((try? JSONSerialization.data(withJSONObject: ["id": id, "body": ["error": "not-running"]])) ?? Data())
        return
    }
    let bytes = [UInt8](line) + [0x0A]
    var done = 0
    while done < bytes.count {
        let n = bytes.withUnsafeBytes { write(fd, $0.baseAddress! + done, bytes.count - done) }
        if n <= 0 { return }
        done += n
    }
}

let input = FileHandle.standardInput
while true {
    let header = input.readData(ofLength: 4)
    guard header.count == 4 else { exit(0) }
    let length = header.withUnsafeBytes { UInt32(littleEndian: $0.loadUnaligned(as: UInt32.self)) }
    guard length <= 4 * 1024 * 1024 else { exit(1) }
    let body = input.readData(ofLength: Int(length))
    guard body.count == Int(length) else { exit(0) }
    if let message = try? JSONSerialization.jsonObject(with: body) as? [String: Any] { relay(message) }
}
