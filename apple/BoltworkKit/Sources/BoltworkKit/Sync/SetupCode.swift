import Foundation

/// What a signed-in device shows (as a QR code) so a new device can join the same account by scanning it:
/// the Secret Key and, when the vault syncs, the server's address and the email. Never the account password,
/// which is still typed on the new device. Every Boltwork app reads and writes the same text (`src/core/setupCode.ts`).
public struct SetupCode: Equatable, Sendable {
    public static let prefix = "boltwork-setup:"
    private static let version = 1

    /// Nil when the vault doesn't sync: the code then holds only the Secret Key.
    public var server: String?
    /// Another address for the same server, if the showing device has one.
    public var backup: String?
    public var email: String?
    public var secretKey: String

    public init(server: String? = nil, backup: String? = nil, email: String? = nil, secretKey: String) {
        self.server = server
        self.backup = backup
        self.email = email
        self.secretKey = secretKey
    }

    private struct Payload: Codable {
        var v: Int
        var server: String?
        var backup: String?
        var email: String?
        var secretKey: String?
    }

    public var text: String {
        let payload = Payload(v: Self.version, server: Self.filled(server), backup: Self.filled(backup), email: Self.filled(email), secretKey: secretKey)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.withoutEscapingSlashes]
        return Self.prefix + String(decoding: (try? encoder.encode(payload)) ?? Data(), as: UTF8.self)
    }

    /// Throws if `text` isn't a setup code this version can read.
    public init(_ text: String) throws {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.hasPrefix(Self.prefix),
              let payload = try? JSONDecoder().decode(Payload.self, from: Data(trimmed.dropFirst(Self.prefix.count).utf8)) else {
            throw SetupCodeError.notASetupCode
        }
        guard payload.v == Self.version else { throw SetupCodeError.newerVersion }
        guard let secretKey = payload.secretKey, !secretKey.isEmpty else { throw SetupCodeError.notASetupCode }
        self.init(server: Self.filled(payload.server), backup: Self.filled(payload.backup), email: Self.filled(payload.email), secretKey: secretKey)
    }

    private static func filled(_ value: String?) -> String? {
        value.flatMap { $0.isEmpty ? nil : $0 }
    }
}

public enum SetupCodeError: LocalizedError {
    case notASetupCode, newerVersion

    public var errorDescription: String? {
        switch self {
        case .notASetupCode: "That isn’t a Boltwork setup code."
        case .newerVersion: "This setup code needs a newer version of Boltwork."
        }
    }
}
