import Foundation
import Testing
@testable import BoltworkKit

/// Writes a vault full of made-up items for screenshots:
/// `BOLTWORK_DEMO_VAULT=/some/dir swift test --filter DemoVault`. Password "demo password", Secret Key below.
struct DemoVault {
    static let secretKey = "SR1-ABCDEF-GHJKM-NPQRS-TVWXY-Z0123"

    @Test(.enabled(if: ProcessInfo.processInfo.environment["BOLTWORK_DEMO_VAULT"] != nil))
    func write() async throws {
        let dir = URL(filePath: ProcessInfo.processInfo.environment["BOLTWORK_DEMO_VAULT"]!)
        try? FileManager.default.removeItem(at: dir)
        let created = try await VaultStore.create(at: dir, password: "demo password", secretKey: Self.secretKey, cost: VaultCrypto.fastCostForTests)
        let store = try VaultStore.open(created: created, at: dir)
        let vault = store.vaults[0].id

        let logins: [(String, String, String, String, otp: Bool, favorite: Bool, uses: Int)] = [
            ("Northwind Bank", "alex.rivera", "Tr0ub4dor&3-much-longer", "https://northwind.example", true, true, 6),
            ("Mailbox", "alex@rivera.example", "correct horse battery staple", "https://mail.example", true, true, 4),
            ("Code Forge", "arivera", "Gh!7kQ2#vLp9@xZr", "https://codeforge.example", true, false, 3),
            ("Photo Cloud", "alex@rivera.example", "sunshine1", "http://photos.example", false, true, 2),
            ("Streaming Plus", "alex@rivera.example", "sunshine1", "https://stream.example", false, false, 1),
            ("Grocer Online", "alex.r", "pa55word", "https://grocer.example", false, false, 0),
            ("Travel Hub", "alex@rivera.example", "W7#mN2$qR9!tY4&v", "https://travelhub.example", true, false, 1),
            ("Office VPN", "arivera", "7Lk$e9!Qw2", "https://vpn.example", false, false, 0),
        ]
        for login in logins {
            var c = ItemTemplate.blankContent(.login)
            c.title = login.0
            if let i = c.fields.firstIndex(where: { $0.purpose == .username }) { c.fields[i].value = login.1 }
            if let i = c.fields.firstIndex(where: { $0.purpose == .password }) { c.fields[i].value = login.2 }
            c.urls = [ItemURL(url: login.3, primary: true)]
            if login.otp { c.fields.append(Field(id: "otp", label: "one-time password", type: .totp, value: "JBSWY3DPEHPK3PXP")) }
            if login.0 == "Northwind Bank" { c.notes = "Joint account"; c.tags = ["finance", "family"] }
            let item = try store.saveItem(id: nil, vaultId: vault, content: c)
            if login.favorite { try store.setFavorite(item.id, true) }
            for _ in 0..<login.uses { try store.markUsed(item.id) }
        }

        var card = ItemTemplate.blankContent(.creditCard)
        card.title = "Travel Card"
        for i in card.fields.indices {
            switch card.fields[i].label.lowercased() {
            case let l where l.contains("number"): card.fields[i].value = "4111 1111 1111 1111"
            case let l where l.contains("name") || l.contains("holder"): card.fields[i].value = "Alex Rivera"
            case let l where l.contains("expir"): card.fields[i].value = "2027-08"
            default: break
            }
        }
        let cardItem = try store.saveItem(id: nil, vaultId: vault, content: card)
        try store.setFavorite(cardItem.id, true)

        var note = ItemTemplate.blankContent(.secureNote)
        note.title = "Wi-Fi at the cabin"
        note.notes = "Network: Pinecrest\nThe router is behind the bookshelf."
        try store.saveItem(id: nil, vaultId: vault, content: note)
    }
}
