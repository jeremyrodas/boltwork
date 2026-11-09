import Foundation

public enum VaultError: LocalizedError, Equatable {
    case wrongPassword
    case invalidSecretKey
    case decryptionFailed
    case unsupportedFormat
    case newerVersion
    case vaultExists
    case passwordTooShort
    case locked
    case notFound(String)
    case attachmentTooLarge
    case attachmentNotDownloaded
    case lastVault

    public var errorDescription: String? {
        switch self {
        case .wrongPassword: "Incorrect password or Secret Key."
        case .invalidSecretKey: "That Secret Key is not valid. It starts with SR1- and has 26 more characters."
        case .decryptionFailed: "This data couldn’t be decrypted. It may be damaged."
        case .unsupportedFormat: "This is not a Boltwork vault."
        case .newerVersion: "This vault was made by a newer version of Boltwork."
        case .vaultExists: "A vault already exists here."
        case .passwordTooShort: "Use at least 8 characters for your account password."
        case .locked: "The vault is locked."
        case .notFound(let what): "\(what) not found."
        case .attachmentTooLarge: "Attachments can be up to 100 MB."
        case .attachmentNotDownloaded: "This file hasn’t downloaded to this device yet. It will after the next sync."
        case .lastVault: "You need at least one vault."
        }
    }
}
