import BoltworkKit
import SwiftUI

struct ItemHeader: View {
    let item: Item
    let vaultName: String?

    var body: some View {
        HStack(spacing: 16) {
            ItemIcon(category: item.category, size: 56)
            VStack(alignment: .leading, spacing: 4) {
                Text(item.title)
                    .font(.title2.bold())
                    .textSelection(.enabled)
                HStack(spacing: 6) {
                    Text(item.category.displayName)
                    if let vaultName {
                        Text("·")
                        Label(vaultName, systemImage: "lock.square.stack").labelStyle(.titleAndIcon)
                    }
                }
                .font(.subheadline)
                .foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
            if item.favorite {
                Image(systemName: "star.fill").foregroundStyle(.yellow).accessibilityLabel("Favorite")
            }
        }
        .padding(.vertical, 4)
    }
}
