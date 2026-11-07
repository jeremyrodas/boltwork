import SwiftUI

/// Tags as rounded chips.
struct TagChips: View {
    let tags: [String]

    var body: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 6) {
                ForEach(tags, id: \.self) { tag in
                    Text(tag)
                        .font(.subheadline)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6)
                        .background(Theme.selection, in: .capsule)
                }
            }
        }
        .scrollIndicators(.hidden)
    }
}
