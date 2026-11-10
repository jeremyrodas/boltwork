/// `@AppStorage` keys and defaults for this device's preferences. Nothing secret goes here.
enum AppSettings {
    static let autolockMinutes = "autolockMinutes"
    static let defaultAutolockMinutes = 5
    static let clipboardClearSeconds = "clipboardClearSeconds"
    static let defaultClipboardClearSeconds = 90
    static let concealPasswords = "concealPasswords"
    static let itemSort = "itemSort"
    static let checkBreachedPasswords = "checkBreachedPasswords"
    static let generatorOptions = "generatorOptions"
    static let appearance = "appearance"
    static let sshAgent = "sshAgent"
    static let browserLink = "browserLink"
    /// Boltwork asked once to become the AutoFill provider; it doesn't ask again.
    static let autoFillOffered = "autoFillOffered"
}
