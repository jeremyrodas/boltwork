import BoltworkKit
import SwiftUI

/// Organize actions for the item in the detail toolbar.
struct ItemMoreMenu: View {
    @Environment(AppModel.self) private var model
    let item: Item

    var body: some View {
        Menu("More", systemImage: "ellipsis.circle") {
            Button(item.favorite ? "Remove from Favorites" : "Add to Favorites", systemImage: item.favorite ? "star.slash" : "star") {
                model.setFavorite(item, !item.favorite)
            }
            Button("Duplicate", systemImage: "plus.square.on.square") { model.duplicate(item) }
            if model.vaults.count > 1 {
                Menu("Move to Vault", systemImage: "folder") {
                    ForEach(model.vaults.filter { $0.id != item.vaultId }) { vault in
                        Button(vault.name) { model.move(item, to: vault.id) }
                    }
                }
            }
            Divider()
            if item.state == .archived {
                Button("Unarchive", systemImage: "archivebox") { model.restore(item) }
            } else {
                Button("Archive", systemImage: "archivebox") { model.archive(item) }
            }
            Button("Delete", systemImage: "trash", role: .destructive) { model.trash(item) }
        }
    }
}
