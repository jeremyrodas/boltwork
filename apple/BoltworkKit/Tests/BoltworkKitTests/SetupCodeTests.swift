import Foundation
import Testing
@testable import BoltworkKit

struct SetupCodeTests {
    // The same text is checked by the desktop app (test/setupCode.test.ts).
    let text = #"boltwork-setup:{"v":1,"server":"https://sync.example.com","backup":"http://100.64.0.5:8787","email":"sam@example.com","secretKey":"SR1-ABCDEF-GHJKM-NPQRS-TVWXY-Z0123"}"#
    let code = SetupCode(server: "https://sync.example.com", backup: "http://100.64.0.5:8787", email: "sam@example.com", secretKey: "SR1-ABCDEF-GHJKM-NPQRS-TVWXY-Z0123")

    @Test func readsTheSharedText() throws {
        #expect(try SetupCode(text) == code)
    }

    @Test func roundTrips() throws {
        #expect(try SetupCode(code.text) == code)
        let plain = SetupCode(server: "http://192.168.1.20:8787", email: "sam@example.com", secretKey: code.secretKey)
        #expect(try SetupCode(plain.text) == plain)
        #expect(!plain.text.contains("backup"))
    }

    @Test func canHoldOnlyTheSecretKey() throws {
        let keyOnly = #"boltwork-setup:{"v":1,"secretKey":"SR1-ABCDEF-GHJKM-NPQRS-TVWXY-Z0123"}"#
        let parsed = try SetupCode(keyOnly)
        #expect(parsed == SetupCode(secretKey: code.secretKey))
        #expect(SetupCode(secretKey: code.secretKey).text == keyOnly)
    }

    @Test func refusesOtherTextNewerVersionsAndMissingParts() {
        #expect(throws: SetupCodeError.notASetupCode) { try SetupCode("otpauth://totp/x?secret=abc") }
        #expect(throws: SetupCodeError.notASetupCode) { try SetupCode("boltwork-setup:nope") }
        #expect(throws: SetupCodeError.newerVersion) { try SetupCode(text.replacingOccurrences(of: #""v":1"#, with: #""v":2"#)) }
        #expect(throws: SetupCodeError.notASetupCode) { try SetupCode(#"boltwork-setup:{"v":1,"server":"https://x","email":"a@b.c"}"#) }
    }
}
