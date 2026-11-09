import BoltworkKit
import SwiftUI

/// Opens an item's details when a link pushes its `ItemRoute`.
struct ItemDestinations: ViewModifier {
    @Environment(AppModel.self) private var model
    @Binding var sheet: BrowserSheet?

    func body(content: Content) -> some View {
        content.navigationDestination(for: ItemRoute.self) { route in
            if let item = model.item(id: route.id) {
                ItemDetailView(item: item, sheet: $sheet)
            } else {
                ContentUnavailableView("Item Not Found", systemImage: "key.horizontal", description: Text("It may have been deleted on another device."))
            }
        }
    }
}

extension View {
    func itemDestinations(sheet: Binding<BrowserSheet?>) -> some View {
        modifier(ItemDestinations(sheet: sheet))
    }
}
