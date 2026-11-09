import BoltworkKit
import SwiftUI

/// Where the item lives, then its big icon and title.
struct ItemHeader: View {
    let item: Item
    let vaultName: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 6) {
                if let vaultName {
                    Label(vaultName, systemImage: "lock.square.stack")
                    Text("|").foregroundStyle(Theme.line)
                }
                Label(item.category.displayName, systemImage: item.category.symbol)
                if item.favorite {
                    Text("|").foregroundStyle(Theme.line)
                    Label("Favorite", systemImage: "star.fill")
                        .foregroundStyle(.yellow)
                }
            }
            .font(.subheadline)
            .foregroundStyle(.secondary)
            .labelStyle(.titleAndIcon)
            HStack(spacing: 16) {
                ItemIcon(category: item.category, size: 64)
                Text(item.title)
                    .font(.title2.weight(.semibold))
                    .textSelection(.enabled)
            }
        }
        .padding(.horizontal, 4)
        .accessibilityElement(children: .combine)
    }
}
