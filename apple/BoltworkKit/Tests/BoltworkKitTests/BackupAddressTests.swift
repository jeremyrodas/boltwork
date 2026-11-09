import Foundation
import Testing
@testable import BoltworkKit

/// The sync server's backup address: kept with the sync state, and tried only when the main address is out of reach.
struct BackupAddressTests {
    @Test func storedWithSyncStateAndOptional() throws {
        let old = #"{"serverUrl":"https://vault.example.com","email":"a@example.com","cursor":4}"#
        let state = try JSONDecoder().decode(SyncState.self, from: Data(old.utf8))
        #expect(state.backupUrl == nil)
        #expect(state.addresses == ["https://vault.example.com"])

        var withBackup = state
        withBackup.backupUrl = "http://100.73.181.32:8787"
        let decoded = try JSONDecoder().decode(SyncState.self, from: JSONEncoder().encode(withBackup))
        #expect(decoded.backupUrl == "http://100.73.181.32:8787")
        #expect(decoded.addresses == ["https://vault.example.com", "http://100.73.181.32:8787"])
    }

    @Test func oneAddressIsUsedWithoutAsking() async throws {
        // Nothing listens on port 1: with only one address there's no probe, so this doesn't fail.
        let client = try await SyncClient.reachable(["http://127.0.0.1:1"], token: "t")
        #expect(client.serverURL == "http://127.0.0.1:1")
        #expect(client.token == "t")
    }

    @Test func reportsBothAddressesWhenNeitherAnswers() async {
        await #expect {
            _ = try await SyncClient.reachable(["http://127.0.0.1:1", "http://127.0.0.1:2"], probeTimeout: 2)
        } throws: { error in
            let message = (error as? SyncError)?.message ?? ""
            return message.contains("127.0.0.1:1") && message.contains("backup address")
        }
    }
}

/// Against a running sync server: `BOLTWORK_TEST_SERVER=http://127.0.0.1:8787 swift test --filter BackupAddressLive`.
struct BackupAddressLive {
    let server = ProcessInfo.processInfo.environment["BOLTWORK_TEST_SERVER"]

    @Test func fallsBackOnlyWhenMainIsOutOfReach() async throws {
        guard let server else { return }
        let down = "http://127.0.0.1:1"
        #expect(try await SyncClient.reachable([down, server]).serverURL == server)
        #expect(try await SyncClient.reachable([server, down]).serverURL == server)
    }
}
