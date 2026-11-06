import BoltworkKit
import SwiftUI

/// The "+" menu listing every kind of item.
struct NewItemMenu: View {
    @Binding var sheet: BrowserSheet?
    private let common: [ItemCategory] = [.login, .password, .secureNote, .creditCard, .identity]

    var body: some View {
        Menu("New Item", systemImage: "plus") {
            ForEach(common) { category in
                Button(category.displayName, systemImage: category.symbol) { sheet = .newItem(category) }
            }
            Menu("More") {
                ForEach(ItemCategory.allCases.filter { !common.contains($0) }) { category in
                    Button(category.displayName, systemImage: category.symbol) { sheet = .newItem(category) }
                }
            }
        }
        .keyboardShortcut("n")
    }
}
