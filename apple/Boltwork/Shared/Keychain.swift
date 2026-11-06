import Foundation
import LocalAuthentication
import Security

/// Small wrapper over the Keychain's generic-password items.
enum Keychain {
    struct Failure: LocalizedError {
        let status: OSStatus
        var errorDescription: String? {
            if status == errSecMissingEntitlement { return "This build of Boltwork can’t use the Keychain this way. Install a signed build." }
            return SecCopyErrorMessageString(status, nil) as String? ?? "Keychain error \(status)."
        }
    }

    private static func baseQuery(service: String, account: String) -> [String: Any] {
        var q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
        #if os(macOS)
        q[kSecUseDataProtectionKeychain as String] = true
        #endif
        return q
    }

    /// Stores `data`, replacing any existing item. With `accessControl`, reading it needs that (for example, biometrics).
    static func set(_ data: Data, service: String, account: String, accessControl: SecAccessControl? = nil) throws {
        delete(service: service, account: account)
        var q = baseQuery(service: service, account: account)
        q[kSecValueData as String] = data
        if let accessControl {
            q[kSecAttrAccessControl as String] = accessControl
        } else {
            q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        }
        var status = SecItemAdd(q as CFDictionary, nil)
        #if os(macOS)
        // Unsigned development builds can't use the data protection keychain; fall back for plain items.
        if status == errSecMissingEntitlement && accessControl == nil {
            q[kSecUseDataProtectionKeychain as String] = nil
            status = SecItemAdd(q as CFDictionary, nil)
        }
        #endif
        guard status == errSecSuccess else { throw Failure(status: status) }
    }

    /// Reads an item. Pass an authenticated `context` for items protected by biometrics so no second prompt appears.
    static func get(service: String, account: String, context: LAContext? = nil) throws -> Data? {
        var q = baseQuery(service: service, account: account)
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        if let context { q[kSecUseAuthenticationContext as String] = context }
        var result: CFTypeRef?
        var status = SecItemCopyMatching(q as CFDictionary, &result)
        #if os(macOS)
        if status == errSecItemNotFound || status == errSecMissingEntitlement {
            q[kSecUseDataProtectionKeychain as String] = nil
            status = SecItemCopyMatching(q as CFDictionary, &result)
        }
        #endif
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else { throw Failure(status: status) }
        return result as? Data
    }

    static func delete(service: String, account: String) {
        let q = baseQuery(service: service, account: account)
        SecItemDelete(q as CFDictionary)
        #if os(macOS)
        var legacy = q
        legacy[kSecUseDataProtectionKeychain as String] = nil
        SecItemDelete(legacy as CFDictionary)
        #endif
    }
}
