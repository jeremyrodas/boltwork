import BoltworkKit
import SwiftUI

extension ItemCategory {
    var template: ItemTemplate { .for(self) }
    var displayName: String { template.name }
    var symbol: String { template.symbol }

    /// A color per kind of item, used behind its icon.
    var tint: Color {
        switch self {
        case .login, .password, .router, .server, .database, .apiCredential, .sshKey, .emailAccount: .blue
        case .creditCard, .bankAccount, .cryptoWallet, .rewardProgram, .membership: .green
        case .identity, .passport, .driverLicense, .socialSecurityNumber, .outdoorLicense: .orange
        case .secureNote, .document, .softwareLicense: .yellow
        case .medicalRecord: .red
        }
    }
}

extension Item {
    var updatedDate: Date { Date(timeIntervalSince1970: TimeInterval(updatedAt) / 1000) }
    var createdDate: Date { Date(timeIntervalSince1970: TimeInterval(createdAt) / 1000) }
}

extension Attachment {
    var addedDate: Date { Date(timeIntervalSince1970: TimeInterval(addedAt) / 1000) }
}

extension ItemVersion {
    var savedDate: Date { Date(timeIntervalSince1970: TimeInterval(savedAt) / 1000) }
}
