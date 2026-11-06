import BoltworkKit
import Foundation

/// Keeps the open vault in step with its sync server: syncs soon after local changes, and waits on the
/// server's long poll so changes from other devices arrive within seconds.
@MainActor
@Observable
final class SyncController {
    enum Status: Equatable {
        case off, idle, syncing, failed(String), signedOut
    }

    private(set) var status = Status.off
    private(set) var lastSyncAt: Date?
    private(set) var serverURL: String?
    private(set) var email: String?

    /// Called after a sync brings in changes, so the model can refresh what it shows.
    @ObservationIgnored var onRemoteChanges: (() -> Void)?

    @ObservationIgnored private var store: VaultStore?
    @ObservationIgnored private var client: SyncClient?
    @ObservationIgnored private var loop: Task<Void, Never>?
    @ObservationIgnored private var waitTask: Task<SyncClient.Changes, any Error>?
    @ObservationIgnored private var isSyncing = false
    @ObservationIgnored private var pending = false

    var isConfigured: Bool { client != nil }

    /// Takes over an unlocked vault. Starts nothing until `start()`.
    func attach(store: VaultStore) {
        self.store = store
        guard let state = store.syncState else {
            client = nil
            status = .off
            serverURL = nil
            email = nil
            return
        }
        serverURL = state.serverUrl
        email = state.email
        lastSyncAt = state.lastSyncAt.map { Date(timeIntervalSince1970: TimeInterval($0) / 1000) }
        if let token = DeviceSecrets.syncToken(account: store.accountId) {
            client = SyncClient(serverURL: state.serverUrl, token: token)
            status = .idle
        } else {
            client = nil
            status = .signedOut
        }
    }

    func detach() {
        stop()
        store = nil
        client = nil
        status = .off
    }

    /// Uses a newly signed-in client (after joining or connecting an account).
    func use(client: SyncClient) {
        stop()
        self.client = client
        serverURL = store?.syncState?.serverUrl
        email = store?.syncState?.email
        status = .idle
        start()
    }

    func start() {
        guard client != nil, loop == nil else { return }
        loop = Task { [weak self] in await self?.runLoop() }
    }

    func stop() {
        loop?.cancel()
        waitTask?.cancel()
        loop = nil
        waitTask = nil
    }

    /// Call after a local change: syncs now, or right after the sync in progress.
    func syncSoon() {
        guard client != nil else { return }
        if isSyncing {
            pending = true
        } else if loop == nil {
            start()
        } else {
            waitTask?.cancel()
        }
    }

    private func runLoop() async {
        var failures = 0
        while !Task.isCancelled {
            let ok = await syncOnce()
            if Task.isCancelled || client == nil || status == .signedOut { break }
            if pending {
                pending = false
                continue
            }
            if !ok {
                failures += 1
                // Back off while the server is unreachable: 5 s, 10 s, … up to 2 minutes.
                try? await Task.sleep(for: .seconds(min(120, 5 * (1 << min(failures - 1, 5)))))
                continue
            }
            failures = 0
            guard let client, let cursor = store?.syncState?.cursor else { break }
            let wait = Task { try await client.waitForChanges(since: cursor) }
            waitTask = wait
            _ = try? await wait.value
            waitTask = nil
        }
        loop = nil
    }

    /// One sync round, reporting progress in `status`. Returns false if it failed.
    @discardableResult
    func syncOnce() async -> Bool {
        guard let store, let client else { return false }
        isSyncing = true
        status = .syncing
        defer { isSyncing = false }
        do {
            let result = try await SyncEngine.syncOnce(store: store, client: client)
            lastSyncAt = .now
            status = .idle
            if result.pulled > 0 || result.filesDown > 0 || result.conflicts > 0 { onRemoteChanges?() }
            return true
        } catch is CancellationError {
            status = .idle
            return false
        } catch let error as SyncError where error.isSignedOut {
            try? DeviceSecrets.setSyncToken(nil, account: store.accountId)
            self.client = nil
            status = .signedOut
            return false
        } catch {
            status = .failed(error.localizedDescription)
            return false
        }
    }
}
