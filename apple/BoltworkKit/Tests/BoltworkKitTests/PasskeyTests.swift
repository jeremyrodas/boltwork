import CryptoKit
import Foundation
import Testing
@testable import BoltworkKit

struct PasskeyTests {
    @Test func credentialLayoutAndSignature() throws {
        let made = try WebAuthn.newCredential(rpId: "example.com", rpName: "Example", userHandle: [1, 2, 3], userName: "ana", userDisplayName: "")
        let auth = made.authenticatorData
        #expect(Array(auth[0..<32]) == WebAuthn.sha256("example.com"))
        #expect(auth[32] == 0x5D)
        #expect(Array(auth[37..<53]) == WebAuthn.aaguid)
        #expect(Array(auth[55..<71]) == made.credentialID)
        #expect(made.passkey.userDisplayName == nil)
        #expect(made.attestationObject.prefix(1) == [0xA3])

        let hash = WebAuthn.sha256("client data")
        let (authData, sig) = try WebAuthn.assert(made.passkey, rpId: "example.com", clientDataHash: hash)
        let pub = try P256.Signing.PublicKey(derRepresentation: made.publicKeySPKI)
        #expect(pub.isValidSignature(try P256.Signing.ECDSASignature(derRepresentation: sig), for: Data(authData + hash)))
        #expect(throws: WebAuthn.Failure.self) { try WebAuthn.assert(made.passkey, rpId: "evil.com", clientDataHash: hash) }
    }

    @Test func passkeysRoundTripThroughItemJSON() throws {
        let made = try WebAuthn.newCredential(rpId: "a.test", rpName: nil, userHandle: [9], userName: "u", userDisplayName: nil)
        var item = Item(id: "i", vaultId: "v", content: ItemTemplate.blankContent(.login), createdAt: 0)
        item.passkeys = [made.passkey]
        #expect(item.passkeys == [made.passkey])
        #expect(item.passkeyCount == 1)
        item.passkeys = []
        #expect(item.extras["passkeys"] == nil)
    }
}

struct PublicSuffixTests {
    @Test func suffixes() {
        #expect(PublicSuffix.suffix(of: "news.bbc.co.uk") == "co.uk")
        #expect(PublicSuffix.registrableDomain("news.bbc.co.uk") == "bbc.co.uk")
        #expect(PublicSuffix.registrableDomain("github.io") == nil)
        #expect(PublicSuffix.registrableDomain("me.github.io") == "me.github.io")
        #expect(PublicSuffix.suffix(of: "a.b.ck") == "b.ck")
        #expect(PublicSuffix.suffix(of: "www.ck") == "ck")
        #expect(PublicSuffix.registrableDomain("example.com") == "example.com")
        #expect(PublicSuffix.registrableDomain("com") == nil)
    }
}
