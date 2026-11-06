import SwiftUI

/// Modifiers that only exist on iOS, applied as no-ops on macOS.
extension View {
    /// For usernames, codes, keys and URLs: no capitalization or autocorrection.
    func plainTextEntry() -> some View {
        #if os(iOS)
        textInputAutocapitalization(.never).autocorrectionDisabled()
        #else
        autocorrectionDisabled()
        #endif
    }

    func keyboard(_ kind: KeyboardKind) -> some View {
        #if os(iOS)
        keyboardType(kind.uiKeyboardType)
        #else
        self
        #endif
    }
}

enum KeyboardKind {
    case email, url, phone, number, ascii

    #if os(iOS)
    var uiKeyboardType: UIKeyboardType {
        switch self {
        case .email: .emailAddress
        case .url: .URL
        case .phone: .phonePad
        case .number: .numberPad
        case .ascii: .asciiCapable
        }
    }
    #endif
}

extension View {
    /// Secrets typed into an item belong to Boltwork. Without this, iOS treats the editor as a sign-in form and offers
    /// its own strong passwords, then asks to save the item into the Passwords app. The one-time-code content type opts out.
    func notASystemPassword() -> some View {
        #if os(iOS)
        textContentType(.oneTimeCode)
        #else
        self
        #endif
    }
}
