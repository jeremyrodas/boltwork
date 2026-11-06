import BoltworkKit
import SwiftUI

struct ItemRow: View {
    let item: Item

    var body: some View {
        HStack(spacing: 12) {
            ItemIcon(category: item.category)
            VStack(alignment: .leading, spacing: 2) {
                Text(item.title)
                    .lineLimit(1)
                let subtitle = item.content.subtitle
                if !subtitle.isEmpty {
                    Text(subtitle)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 0)
            if item.favorite {
                Image(systemName: "star.fill")
                    .foregroundStyle(.yellow)
                    .font(.footnote)
                    .accessibilityLabel("Favorite")
            }
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }
}
