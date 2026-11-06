import Foundation
import LocalAuthentication
import Security

/// Unlocking with Face ID, Touch ID or Optic ID. The vault's master key is kept in the Keychain behind
/// the current biometric enrollment, so adding a fingerprint or face turns quick unlock off.
enum QuickUnlock {
    private static let service = "app.boltwork.quick-unlock"

    enum Failure: LocalizedError {
        case unavailable, cancelled, missing
        var errorDescription: String? {
            switch self {
            case .unavailable: "Biometric unlock isn’t available on this device."
            case .cancelled: "Unlock was cancelled."
            case .missing: "Quick unlock was turned off because this device’s biometrics changed. Enter your account password."
            }
        }
    }

    /// The biometric this device has, if it can be used.
    static var biometryName: String? {
        let context = LAContext()
        guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil) else { return nil }
        return switch context.biometryType {
        case .faceID: "Face ID"
        case .touchID: "Touch ID"
        case .opticID: "Optic ID"
        default: nil
        }
    }

    /// The biometric this device has, enrolled or not, so settings can explain why it's off.
    static var hardwareName: String? {
        let context = LAContext()
        _ = context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil)
        return switch context.biometryType {
        case .faceID: "Face ID"
        case .touchID: "Touch ID"
        case .opticID: "Optic ID"
        default: nil
        }
    }

    static var symbolName: String {
        switch LAContext().biometryType {
        case .faceID: "faceid"
        case .opticID: "opticid"
        default: "touchid"
        }
    }

    static func isEnabled(account: String) -> Bool {
        UserDefaults.standard.bool(forKey: "quickUnlock.\(account)")
    }

    static func enable(masterKey: [UInt8], account: String) throws {
        var error: Unmanaged<CFError>?
        guard let access = SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly, .biometryCurrentSet, &error) else {
            throw Failure.unavailable
        }
        try Keychain.set(Data(masterKey), service: service, account: account, accessControl: access)
        UserDefaults.standard.set(true, forKey: "quickUnlock.\(account)")
    }

    static func disable(account: String) {
        Keychain.delete(service: service, account: account)
        UserDefaults.standard.removeObject(forKey: "quickUnlock.\(account)")
    }

    /// Asks for biometrics, then returns the master key.
    static func masterKey(account: String, reason: String) async throws -> [UInt8] {
        let context = LAContext()
        context.localizedFallbackTitle = "Use Password"
        do {
            try await context.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: reason)
        } catch let e as LAError where [.userCancel, .appCancel, .systemCancel, .userFallback].contains(e.code) {
            throw Failure.cancelled
        }
        guard let data = try Keychain.get(service: service, account: account, context: context) else {
            disable(account: account)
            throw Failure.missing
        }
        return [UInt8](data)
    }
}
