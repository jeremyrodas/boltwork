import BoltworkKit
import SwiftUI

/// Adds a custom field of a chosen type.
struct AddFieldMenu: View {
    @Binding var fields: [Field]

    private let choices: [(FieldType, String, String)] = [
        (.text, "Text", "textformat"),
        (.concealed, "Password", "key"),
        (.totp, "One-Time Password", "clock"),
        (.url, "URL", "link"),
        (.email, "Email", "envelope"),
        (.phone, "Phone", "phone"),
        (.date, "Date", "calendar"),
        (.multiline, "Long Text", "text.alignleft")
    ]

    var body: some View {
        Menu("Add Field", systemImage: "plus") {
            ForEach(choices, id: \.0) { type, name, symbol in
                Button(name, systemImage: symbol) { add(type, name) }
            }
        }
    }

    private func add(_ type: FieldType, _ name: String) {
        let purpose: FieldPurpose? = type == .totp && !fields.contains { $0.purpose == .totp } ? .totp : nil
        fields.append(Field(id: VaultCrypto.randomId(), label: name.lowercased(), type: type, purpose: purpose))
    }
}
