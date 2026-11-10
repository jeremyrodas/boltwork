import Foundation
import Testing
@testable import BoltworkKit

struct CodeSetupLinkTests {
    let link = try! CodeSetupLink(URL(string: "otpauth://totp/Example%20Bank:sam@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Example%20Bank")!)

    @Test func readsTheSiteAndAccount() {
        #expect(link.issuer == "Example Bank")
        #expect(link.account == "sam@example.com")
    }

    @Test func rejectsLinksThatAreNotTimeBased() {
        #expect(throws: (any Error).self) { try CodeSetupLink(URL(string: "otpauth://hotp/x?secret=JBSWY3DPEHPK3PXP&counter=1")!) }
    }

    @Test func findsTheMatchingLogin() {
        var bank = ItemTemplate.blankContent(.login)
        bank.title = "Example Bank"
        var mail = ItemTemplate.blankContent(.login)
        mail.title = "Mail"
        mail.fields[0].value = "sam@example.com"
        var other = ItemTemplate.blankContent(.login)
        other.title = "Shop"
        #expect(link.isLikely(bank))
        #expect(link.isLikely(mail))
        #expect(!link.isLikely(other))
        #expect(!link.isLikely(ItemTemplate.blankContent(.secureNote)))
    }

    @Test func fillsTheCodeFieldOrAddsOne() throws {
        let filled = link.adding(to: ItemTemplate.blankContent(.login))
        #expect(filled.fields.filter { $0.purpose == .totp }.count == 1)
        #expect(try TOTP(filled.field(for: .totp)!.value).secret == link.totp.secret)

        let added = link.adding(to: ItemTemplate.blankContent(.password))
        #expect(added.field(for: .totp)?.value == link.link)
    }

    @Test func makesANewLoginNamedAfterTheSite() {
        let c = link.newLogin
        #expect(c.title == "Example Bank")
        #expect(c.field(for: .username)?.value == "sam@example.com")
        #expect(c.field(for: .totp)?.value == link.link)
    }
}
