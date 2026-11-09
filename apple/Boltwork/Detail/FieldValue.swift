import BoltworkKit
import SwiftUI

/// A field's value, shown the way its type suggests.
struct FieldValue: View {
    let field: Field
    let hidden: Bool

    var body: some View {
        if hidden {
            Text("••••••••••")
                .accessibilityLabel("Hidden")
        } else {
            switch field.type {
            case .url:
                if let url = Domain.openableURL(field.value) { Link(field.value, destination: url) } else { plain }
            case .email:
                if let url = URL(string: "mailto:\(field.value)") { Link(field.value, destination: url) } else { plain }
            case .phone:
                if let url = URL(string: "tel:\(field.value.filter { $0.isNumber || $0 == "+" })") { Link(field.value, destination: url) } else { plain }
            case .concealed:
                Text(field.value).font(Theme.monospacedSecret).textSelection(.enabled)
            default:
                plain
            }
        }
    }

    private var plain: some View {
        Text(field.value).textSelection(.enabled).multilineTextAlignment(.trailing)
    }
}
