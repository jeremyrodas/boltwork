public enum ItemCategory: String, Codable, CaseIterable, Identifiable, Sendable {
    case login, password, secureNote, creditCard, identity, document, bankAccount, database, driverLicense
    case emailAccount, membership, outdoorLicense, passport, rewardProgram, router, server
    case socialSecurityNumber, softwareLicense, apiCredential, cryptoWallet, medicalRecord, sshKey

    public var id: String { rawValue }
}
