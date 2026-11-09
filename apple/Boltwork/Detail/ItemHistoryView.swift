import BoltworkKit
import SwiftUI

/// Earlier versions of an item, each restorable.
struct ItemHistoryView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let itemID: String
    @State private var restoring: Int?

    var body: some View {
        if let item = model.item(id: itemID) {
            List {
                ForEach(item.history.enumerated(), id: \.element.savedAt) { index, version in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(version.savedDate, format: .dateTime)
                            .font(.headline)
                        Text(version.content.title)
                        if let password = version.content.field(for: .password)?.value {
                            HStack {
                                Text("Password")
                                    .foregroundStyle(.secondary)
                                Text(password).font(Theme.monospacedSecret).textSelection(.enabled)
                                CopyButton(value: password, secret: true, label: "Copy Old Password")
                            }
                            .font(.subheadline)
                        }
                        Button("Restore This Version", systemImage: "arrow.uturn.backward") { restoring = index }
                            .buttonStyle(.bordered)
                    }
                    .padding(.vertical, 4)
                }
            }
            .navigationTitle("Item History")
            .confirmationDialog("Restore this version?", item: $restoring) { index in
                Button("Restore") {
                    model.restoreVersion(of: item, at: index)
                    dismiss()
                }
            } message: { _ in
                Text("The current version is kept in history, so you can switch back.")
            }
        }
    }
}
