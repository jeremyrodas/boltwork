import Foundation
import Testing
@testable import BoltworkKit

struct VaultStoreTests {
    let v = Vectors.load

    private func unlockFixture() async throws -> VaultStore {
        let dir = try copyOfFixtureVault()
        let key = try await VaultStore.masterKey(at: dir, password: v.keyDerivation.password, secretKey: v.keyDerivation.secretKey)
        return try VaultStore.open(at: dir, key: key)
    }

    @Test func opensVaultMadeByDesktopApp() async throws {
        let store = try await unlockFixture()
        #expect(store.vaults.map(\.name) == ["Personal"])
        let login = try store.item(id: v.itemId)
        #expect(login.title == "Example")
        #expect(login.favorite)
        #expect(login.content.field(for: .username)?.value == "alice@example.com")
        #expect(login.content.field(for: .password)?.value == "newer-password")
        #expect(login.history.first?.content.field(for: .password)?.value == "hunter2-but-longer")
        #expect(login.content.tags == ["work/email", "favorites"])
        #expect(store.items.contains { $0.title == "Wi-Fi notes" && $0.content.notes == "Line one\nLine two" })

        let (meta, bytes) = try store.readAttachment(itemId: login.id, attachmentId: login.attachments[0].id)
        #expect(meta.name == "hello.txt")
        #expect(String(decoding: bytes, as: UTF8.self) == "hello attachment")
    }

    @Test func wrongPasswordIsRejected() async throws {
        let dir = try copyOfFixtureVault()
        await #expect(throws: VaultError.wrongPassword) {
            try await VaultStore.masterKey(at: dir, password: "nope nope", secretKey: v.keyDerivation.secretKey)
        }
    }

    @Test func savingOnlyReSealsChangedRecords() async throws {
        let store = try await unlockFixture()
        let before = store.records.all
        let login = try store.item(id: v.itemId)
        try store.saveItem(id: login.id, vaultId: login.vaultId, content: {
            var c = login.content; c.notes = "edited on iPhone"; return c
        }())
        let after = store.records.all
        let changed = zip(before, after).filter { $0.data != $1.data }.map(\.0.id)
        #expect(changed == [login.id])

        let reopened = try VaultStore.open(at: store.directory, key: try store.masterKeyCopy())
        let saved = try reopened.item(id: login.id)
        #expect(saved.content.notes == "edited on iPhone")
        #expect(saved.history.count == 2)
    }

    @Test func extrasRoundTrip() throws {
        let json = #"{"id":"i1","vaultId":"v1","category":"login","title":"T","urls":[],"fields":[],"sections":[],"notes":"","tags":[],"favorite":false,"state":"active","createdAt":1,"updatedAt":2,"useCount":0,"attachments":[],"history":[],"watchtowerIgnore":[],"passkeys":[{"credentialId":"x","counter":0,"flag":true,"n":1.5}],"futureField":null}"#
        let item = try JSONDecoder().decode(Item.self, from: Data(json.utf8))
        #expect(item.passkeyCount == 1)
        let again = try JSONDecoder().decode(Item.self, from: JSONEncoder().encode(item))
        #expect(again == item)
        #expect(again.extras["futureField"] == .null)
        if case .array(let pk)? = again.extras["passkeys"], case .object(let o) = pk[0] {
            #expect(o["flag"] == .bool(true))
            #expect(o["counter"] == .number(0))
            #expect(o["n"] == .number(1.5))
        } else {
            Issue.record("passkeys lost")
        }
    }

    @Test func createLockAndUnlock() async throws {
        let dir = FileManager.default.temporaryDirectory.appending(path: "boltwork-new-\(UUID().uuidString)")
        let secret = SecretKey.generate()
        let created = try await VaultStore.create(at: dir, password: "a long password", secretKey: secret, cost: VaultCrypto.fastCostForTests)
        let store = try VaultStore.open(created: created, at: dir)
        var content = ItemTemplate.blankContent(.login)
        content.title = "Swift"
        let item = try store.saveItem(id: nil, vaultId: store.vaults[0].id, content: content)
        try store.trash(item.id)
        store.lock()
        #expect(store.isLocked)

        let key = try await VaultStore.masterKey(at: dir, password: "a long password", secretKey: secret.lowercased())
        let reopened = try VaultStore.open(at: dir, key: key)
        #expect(reopened.items.first?.state == .deleted)
        #expect(try reopened.emptyTrash() == 1)
        #expect(reopened.items.isEmpty)
    }
}

/// Writes a vault for `apple/tools/check-swift-vault.ts` to open with the desktop code (set BOLTWORK_EXPORT_DIR).
struct ExportForDesktopCheck {
    @Test(.enabled(if: ProcessInfo.processInfo.environment["BOLTWORK_EXPORT_DIR"] != nil))
    func writeVaultForDesktop() async throws {
        let dir = URL(filePath: ProcessInfo.processInfo.environment["BOLTWORK_EXPORT_DIR"]!)
        try? FileManager.default.removeItem(at: dir)
        let created = try await VaultStore.create(at: dir, password: "swift password", secretKey: "SR1-ABCDEF-GHJKM-NPQRS-TVWXY-Z0123", cost: VaultCrypto.fastCostForTests)
        let store = try VaultStore.open(created: created, at: dir)
        var c = ItemTemplate.blankContent(.login)
        c.title = "Made in Swift"
        c.fields[0].value = "swift@example.com"
        c.fields[1].value = "pässwörd ✓"
        c.urls = [ItemURL(url: "https://swift.org", primary: true)]
        let item = try store.saveItem(id: nil, vaultId: store.vaults[0].id, content: c)
        c.notes = "second version"
        try store.saveItem(id: item.id, vaultId: item.vaultId, content: c)
        try store.addAttachment(itemId: item.id, name: "a.txt", mime: "text/plain", bytes: Data("from swift".utf8))
    }

    @Test(.enabled(if: ProcessInfo.processInfo.environment["BOLTWORK_TIME_KDF"] != nil))
    func timeStrongKdf() throws {
        let start = Date()
        _ = try VaultCrypto.deriveKek(password: "x", secretKey: SecretKey.generate(), kdf: VaultCrypto.newKdfParams())
        print("argon2id 3 x 128 MiB took \(Date().timeIntervalSince(start)) s")
    }
}

/// The Swift half of `apple/tools/sync-check.ts`: needs a running sync server (set BOLTWORK_SYNC_SERVER).
@MainActor
struct SyncAgainstServer {
    @Test(.enabled(if: ProcessInfo.processInfo.environment["BOLTWORK_SYNC_SERVER"] != nil))
    func joinEditAndSync() async throws {
        let server = try SyncServerURL.normalize(ProcessInfo.processInfo.environment["BOLTWORK_SYNC_SERVER"]!)
        let password = "sync test password", secretKey = "SR1-ABCDEF-GHJKM-NPQRS-TVWXY-Z0123", email = "sync@example.com"
        var client = SyncClient(serverURL: server)
        let login = try await SyncEngine.signIn(client: &client, email: email, password: password, secretKey: secretKey, device: "iPhone test")
        let keyset = Keyset(kdf: login.kdf, wrappedKey: login.wrappedKey, accountId: login.accountId)
        let key = try await VaultStore.masterKey(fromRemote: keyset, password: password, secretKey: secretKey)
        let dir = FileManager.default.temporaryDirectory.appending(path: "boltwork-sync-\(UUID().uuidString)")
        let store = try VaultStore.createFromRemote(at: dir, keyset: keyset, key: key, sync: SyncState(serverUrl: server, email: email, cursor: 0))

        let first = try await SyncEngine.syncOnce(store: store, client: client)
        #expect(first.filesDown == 1)
        let desk = try #require(store.items.first { $0.title == "From desktop" })
        #expect(desk.content.field(for: .password)?.value == "desktop-password")
        #expect(String(decoding: try store.readAttachment(itemId: desk.id, attachmentId: desk.attachments[0].id).1, as: UTF8.self) == "desktop file")

        var edited = desk.content
        edited.notes = "edited on iPhone"
        try store.saveItem(id: desk.id, vaultId: desk.vaultId, content: edited)
        var c = ItemTemplate.blankContent(.secureNote)
        c.title = "From iPhone"
        let mine = try store.saveItem(id: nil, vaultId: store.vaults[0].id, content: c)
        try store.addAttachment(itemId: mine.id, name: "phone.txt", mime: "text/plain", bytes: Data("iphone file".utf8))
        let second = try await SyncEngine.syncOnce(store: store, client: client)
        #expect(second.pushed == 2)
        #expect(second.filesUp == 1)
        #expect(store.dirtyRecords.isEmpty)
    }
}
