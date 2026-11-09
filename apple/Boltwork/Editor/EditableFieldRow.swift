import BoltworkKit
import SwiftUI

/// Editing one field, with the right control for its type.
struct EditableFieldRow: View {
    @Binding var field: Field
    let isCustom: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if isCustom {
                TextField("Label", text: $field.label)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .plainTextEntry()
            } else {
                Text(field.label.capitalized(with: .current))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            switch field.type {
            case .concealed:
                SecretFieldEditor(field: $field)
            case .menu:
                Picker(field.label.capitalized(with: .current), selection: $field.value) {
                    Text("None").tag("")
                    ForEach(field.options ?? [], id: \.self) { Text($0).tag($0) }
                }
                .labelsHidden()
            case .multiline:
                TextField(field.label, text: $field.value, axis: .vertical)
                    .lineLimit(3...)
            case .totp:
                TOTPFieldEditor(value: $field.value)
            default:
                TextField(field.label, text: $field.value, prompt: placeholder.map(Text.init))
                    .keyboard(keyboard)
                    .textContentType(contentType)
                    .plainTextEntry()
            }
        }
        .labelsHidden()
        .accessibilityLabel(field.label)
    }

    private var placeholder: String? {
        switch field.type {
        case .date: "YYYY-MM-DD"
        case .monthYear: "MM/YYYY"
        case .url: "https://"
        default: nil
        }
    }

    private var keyboard: KeyboardKind {
        switch field.type {
        case .email: .email
        case .url: .url
        case .phone: .phone
        default: field.purpose == .username ? .email : .ascii
        }
    }

    private var contentType: TextContentType? {
        switch field.type {
        case .email: .emailAddress
        case .url: .URL
        case .phone: .telephoneNumber
        // Never .username: next to a password field, iOS would offer to save the item into its own Passwords app.
        default: nil
        }
    }
}

#if os(iOS)
typealias TextContentType = UITextContentType
#else
typealias TextContentType = NSTextContentType
#endif
