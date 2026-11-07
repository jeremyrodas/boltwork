import BoltworkKit
import SwiftUI

/// Live one-time codes in a sideways row of small cards. Tap a card to copy its code.
struct OneTimeCodeStrip: View {
    let items: [Item]

    var body: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 10) {
                ForEach(items) { OneTimeCodeCard(item: $0) }
            }
            .padding(.vertical, 2)
        }
        .scrollIndicators(.hidden)
        .scrollClipDisabled()
    }
}
