import CryptoKit
import Foundation
import Testing
@testable import BoltworkKit

@MainActor
private final class FakeHost: BrowserBridgeHost {
    var store: VaultStore?
    let version = "test"
    var allowPairing = true
    var decision: BrowserPasskeyDecision = .ok(index: 0, target: nil)
    var prompts: [BrowserPasskeyPrompt] = []
    init(store: VaultStore) { self.store = store }
    func approvePairing(code: String, name: String, origin: String) async -> Bool { allowPairing }
    func approvePasskey(_ prompt: BrowserPasskeyPrompt) async -> BrowserPasskeyDecision { prompts.append(prompt); return decision }
    func waitForUnlock() async -> Bool { store != nil }
    func showMain(route: String?) {}
    func changed() {}
}

@MainActor
struct BrowserBridgeTests {
    private static let origin = "chrome-extension://heephjlhalcgebikhcnialabmojogjih/"

    private func makeStore() async throws -> VaultStore {
        let dir = URL(filePath: NSTemporaryDirectory()).appending(path: "bw-bridge-\(UUID().uuidString)")
        let created = try await VaultStore.create(at: dir, password: "bridge password", secretKey: SecretKey.generate(), cost: VaultCrypto.fastCostForTests)
        let store = try VaultStore.open(created: created, at: dir)
        var c = ItemTemplate.blankContent(.login)
        c.title = "Example"
        c.urls = [ItemURL(url: "https://login.example.com")]
        for (i, f) in c.fields.enumerated() {
            if f.purpose == .username { c.fields[i].value = "ana" }
            if f.purpose == .password { c.fields[i].value = "old-pass" }
        }
        _ = try store.saveItem(id: nil, vaultId: store.vaults[0].id, content: c)
        return store
    }

    @Test func pairingAndLogins() async throws {
        let store = try await makeStore()
        let host = FakeHost(store: store)
        let bridge = BrowserBridge(host: host, pairingsFile: store.directory.appending(path: "pairings.json"))
        #expect(await bridge.handle(["type": "status"], origin: Self.origin)["error"] == "unpaired")
        host.allowPairing = false
        #expect(await bridge.handle(["type": "pair", "code": "1234", "name": "Chrome"], origin: Self.origin)["error"] == "denied")
        host.allowPairing = true
        let token = try #require(await bridge.handle(["type": "pair", "code": "1234", "name": "Chrome"], origin: Self.origin)["token"]?.stringValue)
        #expect(!String(decoding: try Data(contentsOf: bridge.pairings.file), as: UTF8.self).contains(token), "only the hash is stored")

        func ask(_ m: [String: JSONValue]) async -> JSONValue { await bridge.handle(.object(m.merging(["token": .string(token)]) { a, _ in a }), origin: Self.origin) }
        #expect(await ask(["type": "status"])["locked"] == false)
        let matches = await ask(["type": "matches", "url": "https://www.example.com/login"])["items"]?.arrayValue ?? []
        #expect(matches.count == 1)
        #expect(matches.first?["exactHost"] == false)
        #expect(await ask(["type": "matches", "url": "https://example.org/"])["items"]?.arrayValue?.isEmpty == true)
        let id = try #require(matches.first?["id"]?.stringValue)
        #expect(await ask(["type": "fill", "id": .string(id), "url": "https://evil.test/"])["error"] == "domain-mismatch")
        #expect(await ask(["type": "fill", "id": .string(id), "url": "https://login.example.com/"])["password"] == "old-pass")
        #expect(await ask(["type": "checkSave", "url": "https://login.example.com/", "username": "ana", "password": "new-pass"])["status"] == "update")
        #expect(await ask(["type": "update", "id": .string(id), "username": "ana", "password": "new-pass"])["id"] == .string(id))
        #expect(await ask(["type": "checkSave", "url": "https://login.example.com/", "username": "ana", "password": "new-pass"])["status"] == "same")
        #expect(await ask(["type": "save", "url": "https://other.test:8443/signup", "username": "bo", "password": "pw"])["title"] == "other.test")
        #expect(store.items.contains { $0.content.urls.first?.url == "https://other.test:8443" })
    }

    @Test func passkeysFromPages() async throws {
        let store = try await makeStore()
        let host = FakeHost(store: store)
        let bridge = BrowserBridge(host: host, pairingsFile: store.directory.appending(path: "pairings.json"))
        let token = try #require(await bridge.handle(["type": "pair", "code": "1", "name": "Chrome"], origin: Self.origin)["token"])
        let challenge = JSONValue.string(WebAuthn.base64URL(VaultCrypto.randomBytes(32)))
        let create: JSONValue = [
            "type": "passkeyCreate", "token": token, "url": "https://login.example.com/register",
            "request": ["rp": ["id": "example.com", "name": "Example"], "user": ["id": "AQID", "name": "ana", "displayName": "Ana"],
                        "challenge": challenge, "pubKeyCredParams": [["type": "public-key", "alg": -7]]],
        ]
        // The page can't claim a public suffix or another site.
        var bad = create
        if case .object(var o) = bad, case .object(var r) = o["request"]! { r["rp"] = ["id": "com"]; o["request"] = .object(r); bad = .object(o) }
        #expect(await bridge.handle(bad, origin: Self.origin)["error"]?["name"] == "SecurityError")

        let itemID = store.items.first { $0.title == "Example" }!.id
        host.decision = .ok(index: 0, target: itemID)
        let created = await bridge.handle(create, origin: Self.origin)
        let response = try #require(created["response"])
        #expect(host.prompts.last?.suggested == itemID, "the login for that account is suggested")
        #expect(store.items.first { $0.id == itemID }?.passkeys.count == 1)
        let clientData = try #require(WebAuthn.fromBase64URL(response["response"]?["clientDataJSON"]?.stringValue ?? ""))
        #expect(String(decoding: clientData, as: UTF8.self) == "{\"type\":\"webauthn.create\",\"challenge\":\(challenge.encodedForTest),\"origin\":\"https://login.example.com\",\"crossOrigin\":false}")
        // Registering the same account again is refused.
        if case .object(var o) = create, case .object(var r) = o["request"]! {
            r["excludeCredentials"] = [["id": response["id"]!]]
            o["request"] = .object(r)
            #expect(await bridge.handle(.object(o), origin: Self.origin)["error"]?["name"] == "InvalidStateError")
        }

        let get: JSONValue = ["type": "passkeyGet", "token": token, "url": "https://login.example.com/",
                              "request": ["rpId": "example.com", "challenge": challenge]]
        let signedIn = try #require(await bridge.handle(get, origin: Self.origin)["response"])
        let publicKey = try P256.Signing.PublicKey(derRepresentation: WebAuthn.fromBase64URL(response["response"]!["publicKey"]!.stringValue!)!)
        let authData = WebAuthn.fromBase64URL(signedIn["response"]!["authenticatorData"]!.stringValue!)!
        let getClientData = WebAuthn.fromBase64URL(signedIn["response"]!["clientDataJSON"]!.stringValue!)!
        let signature = try P256.Signing.ECDSASignature(derRepresentation: WebAuthn.fromBase64URL(signedIn["response"]!["signature"]!.stringValue!)!)
        #expect(publicKey.isValidSignature(signature, for: Data(authData + WebAuthn.sha256(getClientData))))
        #expect(signedIn["response"]?["userHandle"] == "AQID")

        // Another site sees nothing.
        let elsewhere: JSONValue = ["type": "passkeyGet", "token": token, "url": "https://example.org/", "request": ["challenge": challenge]]
        #expect(await bridge.handle(elsewhere, origin: Self.origin)["fallback"] == true)
    }
}

private extension JSONValue {
    var encodedForTest: String { "\"\(stringValue ?? "")\"" }
}
