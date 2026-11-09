import BoltworkKit
import SwiftUI

/// Copy and organize actions for an item, shared by its context menu and the detail toolbar.
struct ItemActions: View {
    @Environment(AppModel.self) private var model
    let item: Item

    var body: some View {
        if item.state == .deleted {
            Button("Restore", systemImage: "arrow.uturn.backward") { model.restore(item) }
        } else {
            if let username = item.content.field(for: .username)?.value {
                Button("Copy Username", systemImage: "person") { Clipboard.copy(username, secret: false) }
            }
            if let password = item.content.field(for: .password)?.value {
                Button("Copy Password", systemImage: "key") { copyPassword(password) }
            }
            if let secret = item.content.field(for: .totp)?.value, let totp = try? TOTP(secret) {
                Button("Copy One-Time Code", systemImage: "clock") { Clipboard.copy(totp.code(at: .now), secret: true) }
            }
            Divider()
            Button(item.favorite ? "Remove from Favorites" : "Add to Favorites", systemImage: item.favorite ? "star.slash" : "star") {
                model.setFavorite(item, !item.favorite)
            }
            if item.state == .archived {
                Button("Unarchive", systemImage: "archivebox") { model.restore(item) }
            } else {
                Button("Archive", systemImage: "archivebox") { model.archive(item) }
            }
            Button("Delete", systemImage: "trash", role: .destructive) { model.trash(item) }
        }
    }

    private func copyPassword(_ password: String) {
        Clipboard.copy(password, secret: true)
        model.markUsed(item)
    }
}
