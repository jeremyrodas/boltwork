import Foundation

/// Where the app and its AutoFill extension both find the vault, its Keychain items and settings: the
/// app group's container. Builds without the group (an unsigned Mac build) keep everything app-private.
enum SharedContainer {
    static let group = "group.app.boltwork.apple"

    /// The group container, when this build can use it.
    static let url: URL? = {
        #if os(macOS)
        // A Mac build signed without a team has no provisioning profile, and macOS asks the user about
        // every launch's access to an unprovisioned group, so those builds stay app-private.
        // The app and its extension each carry their own profile when signed with a team.
        guard FileManager.default.fileExists(atPath: Bundle.main.bundleURL.appending(path: "Contents/embedded.provisionprofile").path) else { return nil }
        #endif
        return FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group)
    }()

    static var isAvailable: Bool { url != nil }

    /// The Keychain access group shared with the extension, if any.
    static var keychainGroup: String? { isAvailable ? group : nil }

    static let defaults: UserDefaults = isAvailable ? UserDefaults(suiteName: group) ?? .standard : .standard

    static let privateVaultDirectory = URL.applicationSupportDirectory.appending(path: "Boltwork/vault")

    static var vaultDirectory: URL { url?.appending(path: "Boltwork/vault") ?? privateVaultDirectory }

    /// Moves what earlier builds kept app-private into the group container. Run by the app, once per launch.
    static func migrate() {
        guard isAvailable else { return }
        let fm = FileManager.default
        if fm.fileExists(atPath: privateVaultDirectory.appending(path: "vault.json").path),
           !fm.fileExists(atPath: vaultDirectory.appending(path: "vault.json").path) {
            try? fm.createDirectory(at: vaultDirectory.deletingLastPathComponent(), withIntermediateDirectories: true)
            if (try? fm.moveItem(at: privateVaultDirectory, to: vaultDirectory)) == nil { return }
        }
        for (key, value) in UserDefaults.standard.dictionaryRepresentation() where key.hasPrefix("quickUnlock.") && defaults.object(forKey: key) == nil {
            defaults.set(value, forKey: key)
        }
    }
}
