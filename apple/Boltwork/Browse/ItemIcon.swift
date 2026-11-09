import BoltworkKit
import SwiftUI

/// A category symbol on a tinted rounded square.
struct ItemIcon: View {
    let category: ItemCategory
    var size = 32.0

    var body: some View {
        Image(systemName: category.symbol)
            .font(.system(size: size * 0.5))
            .foregroundStyle(.white)
            .frame(width: size, height: size)
            .background(category.tint.gradient, in: .rect(cornerRadius: size * 0.25))
            .accessibilityHidden(true)
    }
}
