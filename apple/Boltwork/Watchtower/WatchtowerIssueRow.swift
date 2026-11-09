import BoltworkKit
import SwiftUI

struct WatchtowerIssueRow: View {
    let item: Item
    let detail: String

    var body: some View {
        HStack(spacing: 12) {
            ItemIcon(category: item.category)
            VStack(alignment: .leading, spacing: 2) {
                Text(item.title)
                Text(detail)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        }
        .accessibilityElement(children: .combine)
    }
}
