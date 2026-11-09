import Testing
@testable import BoltworkKit

/// Mirrors `server URLs` in `test/sync.test.ts`.
struct SyncServerURLTests {
    @Test func httpsRequiredExceptPrivateNetworks() throws {
        #expect(try SyncServerURL.normalize("vault.example.com/") == "https://vault.example.com")
        #expect(try SyncServerURL.normalize("192.168.1.92:8787") == "http://192.168.1.92:8787")
        #expect(try SyncServerURL.normalize("100.73.181.32:8787") == "http://100.73.181.32:8787")
        #expect(try SyncServerURL.normalize("https://192.168.1.92:8787") == "https://192.168.1.92:8787")
        for ok in ["http://192.168.1.92:8787", "http://10.0.0.5", "http://172.16.0.1", "http://nas.local:8787", "http://127.0.0.1",
                   "http://100.73.181.32:8787", "http://100.64.0.1", "http://100.127.255.255"] {
            #expect(try SyncServerURL.normalize(ok) == ok, "\(ok)")
        }
        for bad in ["http://172.32.0.1", "http://8.8.8.8", "http://vault.example.com", "http://100.63.255.255", "http://100.128.0.1"] {
            #expect(throws: SyncServerURL.ValidationError.self, "\(bad)") { try SyncServerURL.normalize(bad) }
        }
    }
}
