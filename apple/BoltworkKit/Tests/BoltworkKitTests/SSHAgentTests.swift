#if os(macOS)
import Foundation
import Testing
@testable import BoltworkKit

/// Checks the SSH key code and agent against OpenSSH's own tools.
@Suite(.serialized)
struct SSHAgentTests {
    private struct Backend: SSHAgentBackend {
        let keys: [String: SSHKey]
        func identities() async -> [SSHAgentIdentity] {
            keys.sorted { $0.key < $1.key }.map { SSHAgentIdentity(id: $0.key, blob: $0.value.publicBlob, comment: $0.value.comment) }
        }
        func sign(_ identity: SSHAgentIdentity, data: [UInt8], flags: UInt32) async -> [UInt8]? {
            try? keys[identity.id]?.sign(data, flags: flags)
        }
    }

    @discardableResult
    private func run(_ args: [String], in dir: URL, agent: String? = nil, input: String? = nil) throws -> String {
        let p = Process()
        p.executableURL = URL(filePath: "/usr/bin/env")
        p.arguments = args
        p.currentDirectoryURL = dir
        var env = ProcessInfo.processInfo.environment
        env["SSH_AUTH_SOCK"] = agent
        p.environment = env
        let out = Pipe()
        p.standardOutput = out
        p.standardError = out
        if let input {
            let inPipe = Pipe()
            p.standardInput = inPipe
            inPipe.fileHandleForWriting.write(Data(input.utf8))
            try inPipe.fileHandleForWriting.close()
        }
        try p.run()
        p.waitUntilExit()
        let text = String(decoding: out.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
        guard p.terminationStatus == 0 else { throw CommandFailed(text: "\(args.joined(separator: " ")): \(text)") }
        return text
    }

    struct CommandFailed: Error, CustomStringConvertible { let text: String; var description: String { text } }

    @Test func keysAndAgentMatchOpenSSH() async throws {
        let dir = URL(filePath: NSTemporaryDirectory()).appending(path: "bw-ssh-\(UUID().uuidString.prefix(8))")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        try run(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-C", "ed@test", "-f", "ed"], in: dir)
        try run(["ssh-keygen", "-q", "-t", "rsa", "-b", "3072", "-N", "", "-C", "rsa@test", "-f", "rsa"], in: dir)

        var keys: [String: SSHKey] = [:]
        for name in ["ed", "rsa"] {
            let key = try SSHKey(openSSH: String(contentsOf: dir.appending(path: name), encoding: .utf8))
            let pub = try String(contentsOf: dir.appending(path: "\(name).pub"), encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines)
            #expect(key.publicKeyLine == pub)
            #expect(try run(["ssh-keygen", "-l", "-f", "\(name).pub"], in: dir).contains(key.fingerprint))
            // What Boltwork writes, OpenSSH reads.
            try key.openSSH.write(to: dir.appending(path: "\(name)-bw"), atomically: true, encoding: .utf8)
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: dir.appending(path: "\(name)-bw").path)
            #expect(try run(["ssh-keygen", "-y", "-f", "\(name)-bw"], in: dir).hasPrefix(pub.split(separator: " ").prefix(2).joined(separator: " ")))
            keys[name] = key
        }
        #expect(keys["rsa"]?.typeName == "RSA 3072-bit")

        let socket = dir.appending(path: "a.sock").path
        let server = try SSHAgentServer(path: socket, backend: Backend(keys: keys))
        defer { server.stop() }
        let listed = try run(["ssh-add", "-L"], in: dir, agent: socket)
        for name in ["ed", "rsa"] { #expect(listed.contains(keys[name]!.publicKeyLine)) }

        try "hello".write(to: dir.appending(path: "msg"), atomically: true, encoding: .utf8)
        for name in ["ed", "rsa"] {
            try FileManager.default.removeItem(at: dir.appending(path: name)) // only the agent can sign now
            try run(["ssh-keygen", "-Y", "sign", "-f", "\(name).pub", "-n", "test", "msg"], in: dir, agent: socket)
            try "\(name)@test \(keys[name]!.publicKeyLine)\n".write(to: dir.appending(path: "signers"), atomically: true, encoding: .utf8)
            try run(["ssh-keygen", "-Y", "verify", "-f", "signers", "-I", "\(name)@test", "-n", "test", "-s", "msg.sig"], in: dir, input: "hello")
            try FileManager.default.removeItem(at: dir.appending(path: "msg.sig"))
        }

        let made = SSHKey.generateEd25519(comment: "new")
        #expect(try SSHKey(openSSH: made.openSSH).publicKeyLine == made.publicKeyLine)
    }

    @Test func modArithmetic() {
        #expect(BigBytes.mod([0x01, 0x00], [0x07]).drop { $0 == 0 } == [UInt8(256 % 7)])
        #expect(BigBytes.minusOne([0x01, 0x00]) == [0x00, 0xFF])
    }
}
#endif
