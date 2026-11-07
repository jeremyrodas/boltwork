import BoltworkKit
import SwiftUI
import UniformTypeIdentifiers
#if os(macOS)
import AppKit
#endif

/// The app's state: whether the vault exists and is unlocked, what's in it, and every change made to it.
/// Views read `items` and `vaults`; all changes go through methods here so the vault is saved and synced.
@MainActor
@Observable
final class AppModel {
    enum Phase: Equatable {
        case welcome, locked, unlocked
    }

    private(set) var phase: Phase
    private(set) var vaults: [Vault] = []
    private(set) var items: [Item] = []
    private(set) var accountId: String?
    /// Set when the unlock repaired data an older desktop version sealed badly.
    var repairNotice: String?
    /// A just-created account's Secret Key, shown until the user confirms they saved it.
    var newSecretKey: NewSecretKey?
    /// An error to show in an alert.
    var alertMessage: String?

    let sync = SyncController()
    #if os(macOS)
    let sshAgent = SSHAgentController()
    let browserLink = BrowserLinkController()
    #endif

    @ObservationIgnored private var store: VaultStore?
    @ObservationIgnored private var backgroundedAt: Date?
    @ObservationIgnored private var idleWatcher: Task<Void, Never>?
    #if os(macOS)
    @ObservationIgnored private var screenLockObserver: ScreenLockObserver?
    #endif
    let directory: URL

    static var defaultDirectory: URL {
        #if DEBUG
        // UI tests point the app at a fresh folder with `-vaultDirectory <path>`.
        if let path = UserDefaults.standard.string(forKey: "vaultDirectory") { return URL(filePath: path) }
        #endif
        SharedContainer.migrate()
        return SharedContainer.vaultDirectory
    }

    init(directory: URL = AppModel.defaultDirectory) {
        self.directory = directory
        accountId = VaultStore.peekAccountId(at: directory)
        phase = VaultStore.exists(at: directory) ? .locked : .welcome
        sync.onRemoteChanges = { [weak self] in self?.refresh() }
        #if os(macOS)
        sshAgent.model = self
        if UserDefaults.standard.bool(forKey: AppSettings.sshAgent) { sshAgent.setEnabled(true) }
        browserLink.model = self
        if UserDefaults.standard.bool(forKey: AppSettings.browserLink) { browserLink.setEnabled(true) }
        watchForSleep()
        #endif
    }

    // MARK: - Creating, joining and unlocking

    /// The Secret Key this device remembers, if any.
    var storedSecretKey: String? { accountId.flatMap(DeviceSecrets.secretKey(account:)) }

    var canQuickUnlock: Bool {
        guard let accountId else { return false }
        return QuickUnlock.isEnabled(account: accountId) && QuickUnlock.biometryName != nil
    }

    var isQuickUnlockEnabled: Bool { accountId.map(QuickUnlock.isEnabled(account:)) ?? false }

    /// Makes a new vault and presents its Secret Key, which the user must save.
    func createVault(password: String) async throws {
        let secretKey = SecretKey.generate()
        let created = try await VaultStore.create(at: directory, password: password, secretKey: secretKey)
        let store = try VaultStore.open(created: created, at: directory)
        try DeviceSecrets.setSecretKey(secretKey, account: store.accountId)
        newSecretKey = NewSecretKey(value: secretKey)
        didUnlock(store)
    }

    /// Sets this device up from an existing account on a sync server.
    func joinAccount(server: String, email: String, password: String, secretKey: String) async throws {
        let normalizedKey = try SecretKey.normalize(secretKey)
        let serverURL = try SyncServerURL.normalize(server)
        var client = SyncClient(serverURL: serverURL)
        let login = try await SyncEngine.signIn(client: &client, email: email, password: password, secretKey: normalizedKey, device: Self.deviceName)
        let keyset = Keyset(kdf: login.kdf, wrappedKey: login.wrappedKey, accountId: login.accountId)
        let key = try await VaultStore.masterKey(fromRemote: keyset, password: password, secretKey: normalizedKey)
        let store = try VaultStore.createFromRemote(at: directory, keyset: keyset, key: key,
                                                    sync: SyncState(serverUrl: serverURL, email: email, cursor: 0, lastSyncAt: nil))
        try DeviceSecrets.setSecretKey(normalizedKey, account: store.accountId)
        try DeviceSecrets.setSyncToken(client.token, account: store.accountId)
        didUnlock(store)
        sync.use(client: client)
    }

    /// Unlocks with the account password. `secretKey` is needed only if this device doesn't remember it.
    func unlock(password: String, secretKey: String? = nil) async throws {
        guard let key = secretKey.flatMap({ $0.isEmpty ? nil : $0 }) ?? storedSecretKey else { throw VaultError.invalidSecretKey }
        let normalized = try SecretKey.normalize(key)
        let masterKey = try await VaultStore.masterKey(at: directory, password: password, secretKey: normalized)
        let store = try VaultStore.open(at: directory, key: masterKey)
        if storedSecretKey == nil { try DeviceSecrets.setSecretKey(normalized, account: store.accountId) }
        didUnlock(store)
    }

    func unlockWithBiometrics() async throws {
        guard let accountId else { return }
        let key = try await QuickUnlock.masterKey(account: accountId, reason: "Unlock your Boltwork vault")
        do {
            didUnlock(try VaultStore.open(at: directory, key: key))
        } catch {
            QuickUnlock.disable(account: accountId)
            throw error
        }
    }

    private func didUnlock(_ store: VaultStore) {
        self.store = store
        DeviceSecrets.share(account: store.accountId)
        accountId = store.accountId
        if store.repairedBlankKey > 0 {
            repairNotice = "Boltwork repaired \(store.repairedBlankKey) items that an earlier version saved incorrectly on this device."
        }
        refresh()
        phase = .unlocked
        sync.attach(store: store)
        sync.start()
        startIdleWatcher()
    }

    func lock() {
        guard phase == .unlocked else { return }
        sync.detach()
        store?.lock()
        store = nil
        items = []
        vaults = []
        idleWatcher?.cancel()
        AttachmentPreview.clear()
        #if os(macOS)
        sshAgent.locked()
        #endif
        phase = .locked
    }

    // MARK: - Account

    func setQuickUnlock(_ enabled: Bool) {
        guard let store else { return }
        if enabled {
            do { try QuickUnlock.enable(masterKey: try store.masterKeyCopy(), account: store.accountId) } catch { alertMessage = error.localizedDescription }
        } else {
            QuickUnlock.disable(account: store.accountId)
        }
    }

    func changePassword(current: String, new: String) async throws {
        guard let store, let secretKey = storedSecretKey else { throw VaultError.locked }
        let (keyset, authKey) = try await VaultStore.rewrap(keyset: store.keyset, masterKey: try store.masterKeyCopy(),
                                                            oldPassword: current, newPassword: new, secretKey: secretKey)
        // Update the server first: if that fails, the old password still works everywhere.
        if let state = store.syncState, let token = DeviceSecrets.syncToken(account: store.accountId) {
            try await SyncClient(serverURL: state.serverUrl, token: token).updateKeys(authKey: authKey, keyset: keyset)
        }
        try store.adopt(keyset: keyset)
    }

    /// Checks the account password, for showing the Secret Key and similar.
    func verifyPassword(_ password: String) async -> Bool {
        guard let store, let secretKey = storedSecretKey else { return false }
        return (try? await VaultStore.authKey(keyset: store.keyset, password: password, secretKey: secretKey)) != nil
    }

    // MARK: - Reading

    func item(id: String?) -> Item? { id.flatMap { id in items.first { $0.id == id } } }
    func vault(id: String) -> Vault? { vaults.first { $0.id == id } }
    var allTags: [String] { Set(items.filter { $0.state == .active }.flatMap(\.content.tags)).sorted { $0.localizedStandardCompare($1) == .orderedAscending } }
    var pwnedCounts: [String: Int] { store?.pwnedCounts ?? [:] }

    private func refresh() {
        guard let store else { return }
        vaults = store.vaults
        items = store.items
        updateAutoFill()
    }

    /// Picks up what the AutoFill extension saved (a new passkey, a use count) while the app was in the background.
    private func reloadIfChangedOnDisk() {
        guard let store, store.changedOnDisk, let key = try? store.masterKeyCopy(), let fresh = try? VaultStore.open(at: directory, key: key) else { return }
        sync.detach()
        store.lock()
        self.store = fresh
        refresh()
        sync.attach(store: fresh)
    }

    /// The open vault, for the browser link, which changes it directly and then calls `storeChanged()`.
    var openStore: VaultStore? { phase == .unlocked ? store : nil }

    func storeChanged() {
        refresh()
        sync.syncSoon()
    }

    #if os(macOS)
    /// Brings Boltwork forward and waits up to a minute for the user to unlock it (for ssh or the browser).
    func waitForUnlock() async -> Bool {
        if phase == .unlocked { return true }
        NSApp.activate()
        for _ in 0..<200 {
            try? await Task.sleep(for: .milliseconds(300))
            if phase == .unlocked { return true }
        }
        return false
    }
    #endif

    @ObservationIgnored private var autoFillUpdate: Task<Void, Never>?

    /// Tells the system which sites and accounts Boltwork can fill, a moment after changes settle.
    func updateAutoFill() {
        autoFillUpdate?.cancel()
        let items = items
        autoFillUpdate = Task {
            try? await Task.sleep(for: .seconds(1))
            guard !Task.isCancelled else { return }
            await CredentialIdentities.replace(with: items)
        }
    }

    // MARK: - Changing

    /// Runs a change against the vault, then refreshes and syncs. Errors are shown in an alert.
    @discardableResult
    func perform<T>(_ change: (VaultStore) throws -> T) -> T? {
        guard let store else { return nil }
        do {
            let result = try change(store)
            refresh()
            sync.syncSoon()
            return result
        } catch {
            alertMessage = error.localizedDescription
            return nil
        }
    }

    @discardableResult
    func saveItem(id: String?, vaultId: String, content: ItemContent) -> Item? {
        perform { try $0.saveItem(id: id, vaultId: vaultId, content: content) }
    }

    func setFavorite(_ item: Item, _ favorite: Bool) { perform { try $0.setFavorite(item.id, favorite) } }
    func archive(_ item: Item) { perform { try $0.archive(item.id) } }
    func trash(_ item: Item) { perform { try $0.trash(item.id) } }
    func restore(_ item: Item) { perform { try $0.restore(item.id) } }
    func purge(_ item: Item) { perform { try $0.purge(item.id) } }
    func emptyTrash() { perform { try $0.emptyTrash() } }
    func move(_ item: Item, to vaultId: String) { perform { try $0.move(item.id, toVault: vaultId) } }
    func markUsed(_ item: Item) { perform { try $0.markUsed(item.id) } }
    @discardableResult func duplicate(_ item: Item) -> Item? { perform { try $0.duplicateItem(id: item.id) } }
    func restoreVersion(of item: Item, at index: Int) { perform { try $0.restoreVersion(itemId: item.id, index: index) } }

    func saveVault(_ vault: Vault) { perform { try $0.saveVault(vault) } }

    func newVault(named name: String) {
        perform { try $0.saveVault(Vault(id: VaultCrypto.randomId(), name: name, createdAt: Int64(Date.now.timeIntervalSince1970 * 1000))) }
    }

    func deleteVault(_ vault: Vault, movingItemsTo target: String?) { perform { try $0.deleteVault(id: vault.id, moveItemsTo: target) } }

    func addAttachment(to item: Item, from url: URL) {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        do {
            let data = try Data(contentsOf: url)
            let mime = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
            perform { try $0.addAttachment(itemId: item.id, name: url.lastPathComponent, mime: mime, bytes: data) }
        } catch {
            alertMessage = error.localizedDescription
        }
    }

    func removeAttachment(_ attachment: Attachment, from item: Item) {
        perform { try $0.removeAttachment(itemId: item.id, attachmentId: attachment.id) }
    }

    /// Decrypts an attachment to a temporary file for previewing or sharing; removed on lock.
    func previewURL(for attachment: Attachment, in item: Item) -> URL? {
        guard let store else { return nil }
        do {
            let (meta, data) = try store.readAttachment(itemId: item.id, attachmentId: attachment.id)
            return try AttachmentPreview.write(data, named: meta.name, id: meta.id)
        } catch {
            alertMessage = error.localizedDescription
            return nil
        }
    }

    func recordPwned(sha1: String, count: Int) {
        store?.recordPwned(sha1: sha1, count: count)
        try? store?.writeFile()
    }

    // MARK: - Sync setup

    /// Connects this vault to a sync server, creating the account there or signing in to the existing one.
    func connectSync(server: String, email: String, password: String, createAccount: Bool) async throws {
        guard let store, let secretKey = storedSecretKey else { throw VaultError.locked }
        let serverURL = try SyncServerURL.normalize(server)
        let authKey = try await VaultStore.authKey(keyset: store.keyset, password: password, secretKey: secretKey)
        var client = SyncClient(serverURL: serverURL)
        if createAccount {
            try await client.signup(email: email, authKey: authKey, keyset: store.keyset, device: Self.deviceName)
        } else {
            let login = try await client.login(email: email, authKey: authKey, device: Self.deviceName)
            guard login.accountId == store.accountId else {
                try? await client.logout()
                throw SyncError(status: 0, message: "That account on the server holds a different vault. To use it on this device, delete this vault and join the account instead.")
            }
        }
        store.syncState = SyncState(serverUrl: serverURL, email: email, cursor: 0, lastSyncAt: nil)
        try store.writeFile()
        try DeviceSecrets.setSyncToken(client.token, account: store.accountId)
        sync.use(client: client)
    }

    /// Signs back in after the server ended this device's session.
    func signInToSync(password: String) async throws {
        guard let store, let state = store.syncState, let secretKey = storedSecretKey else { throw VaultError.locked }
        let authKey = try await VaultStore.authKey(keyset: store.keyset, password: password, secretKey: secretKey)
        var client = SyncClient(serverURL: state.serverUrl)
        _ = try await client.login(email: state.email, authKey: authKey, device: Self.deviceName)
        try DeviceSecrets.setSyncToken(client.token, account: store.accountId)
        sync.use(client: client)
    }

    func disconnectSync() async {
        guard let store else { return }
        if let state = store.syncState, let token = DeviceSecrets.syncToken(account: store.accountId) {
            try? await SyncClient(serverURL: state.serverUrl, token: token).logout()
        }
        try? DeviceSecrets.setSyncToken(nil, account: store.accountId)
        store.syncState = nil
        try? store.writeFile()
        sync.attach(store: store)
    }

    static var deviceName: String {
        #if os(iOS)
        "Boltwork for iPhone"
        #else
        Host.current().localizedName.map { "Boltwork on \($0)" } ?? "Boltwork for Mac"
        #endif
    }

    // MARK: - Auto-lock

    private var autolockMinutes: Int {
        UserDefaults.standard.object(forKey: AppSettings.autolockMinutes) as? Int ?? AppSettings.defaultAutolockMinutes
    }

    /// Locks when the app comes back after being away longer than the auto-lock time.
    func scenePhaseChanged(to newPhase: ScenePhase) {
        switch newPhase {
        case .background:
            backgroundedAt = .now
            sync.stop()
            if autolockMinutes == 0 { lock() }
        case .active:
            if let since = backgroundedAt, autolockMinutes >= 0, Date.now.timeIntervalSince(since) >= Double(autolockMinutes * 60) {
                lock()
            }
            backgroundedAt = nil
            if phase == .unlocked {
                reloadIfChangedOnDisk()
                sync.start()
            }
        default:
            break
        }
    }

    /// On the Mac, also locks after the auto-lock time with no keyboard or mouse input.
    private func startIdleWatcher() {
        #if os(macOS)
        idleWatcher?.cancel()
        idleWatcher = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(30))
                guard let self, self.phase == .unlocked else { return }
                let minutes = self.autolockMinutes
                guard minutes > 0, let anyInput = CGEventType(rawValue: ~0) else { continue }
                if CGEventSource.secondsSinceLastEventType(.combinedSessionState, eventType: anyInput) >= Double(minutes * 60) {
                    self.lock()
                }
            }
        }
        #endif
    }

    #if os(macOS)
    /// Locks when the Mac sleeps or its screen locks.
    private func watchForSleep() {
        Task { [weak self] in
            for await _ in NSWorkspace.shared.notificationCenter.notifications(named: NSWorkspace.willSleepNotification) { self?.lock() }
        }
        screenLockObserver = ScreenLockObserver { [weak self] in self?.lock() }
    }
    #endif
}

#if os(macOS)
/// Hears the Mac's screen lock right away. Without `.deliverImmediately`, macOS holds the notification
/// until Boltwork is the active app again, so a vault left open in the background stayed unlocked.
private final class ScreenLockObserver: NSObject {
    private let onLock: () -> Void

    init(onLock: @escaping () -> Void) {
        self.onLock = onLock
        super.init()
        DistributedNotificationCenter.default().addObserver(self, selector: #selector(screenLocked), name: .init("com.apple.screenIsLocked"),
                                                            object: nil, suspensionBehavior: .deliverImmediately)
    }

    @objc private func screenLocked() { onLock() }
}
#endif
