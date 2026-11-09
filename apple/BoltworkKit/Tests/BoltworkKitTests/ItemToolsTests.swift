import Foundation
import Testing
@testable import BoltworkKit

struct ItemToolsTests {
    @Test func totpMatchesDesktop() throws {
        let totp = try TOTP("JBSWY3DPEHPK3PXP")
        for t in Vectors.load.totp {
            #expect(totp.code(at: Date(timeIntervalSince1970: t.t / 1000)) == t.code)
        }
    }

    @Test func totpRFC6238() throws {
        // RFC 6238 appendix B, SHA-1, 8 digits.
        let secret = "otpauth://totp/ACME:alice?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&digits=8&issuer=ACME"
        let totp = try TOTP(secret)
        #expect(totp.issuer == "ACME" && totp.account == "alice")
        #expect(totp.code(at: Date(timeIntervalSince1970: 59)) == "94287082")
        #expect(totp.code(at: Date(timeIntervalSince1970: 1_111_111_109)) == "07081804")
    }

    @Test func generatorHonorsOptions() {
        var o = GeneratorOptions()
        o.length = 32
        let pw = PasswordGenerator.generate(o)
        #expect(pw.count == 32)
        #expect(pw.contains { $0.isNumber } && pw.contains { $0.isUppercase })
        o.mode = .words
        #expect(PasswordGenerator.generate(o).split(separator: "-").count == 4)
        o.mode = .pin
        #expect(PasswordGenerator.generate(o).allSatisfy { $0.isNumber })
        #expect(PasswordGenerator.words.count == 7776)
    }

    @Test func strengthScale() {
        #expect(PasswordStrength("").level == 0)
        #expect(PasswordStrength("password").isWeak)
        #expect(PasswordStrength("aaaaaaaa").isWeak)
        #expect(PasswordStrength("qwerty123").isWeak)
        #expect(!PasswordStrength(PasswordGenerator.generate()).isWeak)
        #expect(PasswordStrength(PasswordGenerator.generate()).level >= 6)
    }

    @Test func watchtowerFindsReusedAndWeak() {
        func login(_ id: String, _ pw: String, url: String) -> Item {
            var c = ItemTemplate.blankContent(.login)
            c.title = id
            c.fields[1].value = pw
            c.urls = [ItemURL(url: url)]
            return Item(id: id, vaultId: "v", content: c, createdAt: 0)
        }
        let items = [login("a", "password", url: "http://example.com"), login("b", "password", url: "https://b.com"), login("c", "Correct-Horse-Battery-Staple-9", url: "https://c.com")]
        let report = Watchtower.run(items: items)
        #expect(report.count(.reused) == 2)
        #expect(report.count(.weak) == 2)
        #expect(report.count(.unsecured) == 1)
        #expect(report.score < 1000)
    }
}

struct StrengthSamples {
    @Test func longMixedPasswordIsStrong() {
        #expect(PasswordStrength("Tr0ub4dor&3-much-longer").level >= 5)
        #expect(PasswordStrength("T").level <= 1)
    }
}
