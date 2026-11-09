import Foundation
import Testing
@testable import BoltworkKit

/// Cross-checks key formats with Node: `PASSKEY_NODE_CHECK=<dir> swift test --filter PasskeyNodeCheck`.
/// Reads `node.json` ({privateKey}) to sign with, and writes `swift.json` for Node to verify.
@Test(.enabled(if: ProcessInfo.processInfo.environment["PASSKEY_NODE_CHECK"] != nil))
func passkeyNodeCheck() throws {
    let dir = URL(filePath: ProcessInfo.processInfo.environment["PASSKEY_NODE_CHECK"]!)
    let node = try JSONDecoder().decode([String: String].self, from: Data(contentsOf: dir.appending(path: "node.json")))
    let hash = WebAuthn.sha256("hello")
    let nodeKey = Passkey(credentialId: "x", rpId: "a.test", userHandle: "AQ", userName: "", privateKey: node["privateKey"]!, algorithm: -7, createdAt: 0)
    let signed = try WebAuthn.assert(nodeKey, rpId: "a.test", clientDataHash: hash)
    let made = try WebAuthn.newCredential(rpId: "a.test", rpName: nil, userHandle: [1], userName: "", userDisplayName: nil)
    let out = ["nodeKeySignature": WebAuthn.base64URL(signed.signature), "authData": WebAuthn.base64URL(signed.authenticatorData),
               "swiftPrivateKey": made.passkey.privateKey, "swiftSPKI": WebAuthn.base64URL(made.publicKeySPKI)]
    try JSONEncoder().encode(out).write(to: dir.appending(path: "swift.json"))
}
