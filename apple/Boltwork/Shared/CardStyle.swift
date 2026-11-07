import SwiftUI

/// A rounded panel on the page background, with a hairline edge.
struct CardStyle: ViewModifier {
    func body(content: Content) -> some View {
        content
            .background(Theme.card, in: .rect(cornerRadius: Theme.cardCornerRadius))
            .overlay {
                RoundedRectangle(cornerRadius: Theme.cardCornerRadius)
                    .strokeBorder(Theme.line, lineWidth: 1)
            }
    }
}

extension View {
    func card() -> some View {
        modifier(CardStyle())
    }
}
