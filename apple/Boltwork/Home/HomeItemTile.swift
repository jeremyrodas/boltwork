import BoltworkKit
import SwiftUI

/// An item's icon, title and subtitle, for Home's cards.
struct HomeItemTile: View {
    let item: Item
    var showsChevron = false

    var body: some View {
        HStack(spacing: 12) {
            ItemIcon(category: item.category, size: 36)
            VStack(alignment: .leading, spacing: 1) {
                Text(item.title)
                    .font(.subheadline.weight(.medium))
                    .lineLimit(1)
                let subtitle = item.content.subtitle
                if !subtitle.isEmpty {
                    Text(subtitle)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 0)
            if showsChevron {
                Image(systemName: "chevron.right")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.tertiary)
            }
        }
        .frame(minHeight: 44)
        .contentShape(.rect)
        .accessibilityElement(children: .combine)
    }
}
