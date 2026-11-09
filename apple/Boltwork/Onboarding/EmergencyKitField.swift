import SwiftUI

/// A labeled box on the Emergency Kit page.
struct EmergencyKitField: View {
    let label: String
    let value: String
    var monospaced = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).font(.caption.bold()).textCase(.uppercase).foregroundStyle(.secondary)
            Text(value)
                .font(monospaced ? .title2.monospaced() : .title3)
                .frame(maxWidth: .infinity, minHeight: 32, alignment: .leading)
                .padding(12)
                .overlay { RoundedRectangle(cornerRadius: 8).stroke(.gray) }
        }
    }
}
