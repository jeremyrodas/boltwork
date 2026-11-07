import SwiftUI

/// Rows in one rounded card, with hairlines between them.
struct DetailCard<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Group(subviews: content) { rows in
                ForEach(rows.enumerated(), id: \.element.id) { index, row in
                    if index > 0 { Divider().overlay(Theme.line).padding(.leading, 16) }
                    row
                }
            }
        }
        .card()
    }
}
