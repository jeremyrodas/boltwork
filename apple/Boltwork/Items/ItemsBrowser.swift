import BoltworkKit
import SwiftUI

/// The Items tab. On iPhone it opens on the list of categories and goes into one; on iPad the
/// categories, the chosen list and the selected item sit side by side.
struct ItemsBrowser: View {
    @Environment(AppModel.self) private var model
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Binding var selection: String?
    @Binding var sheet: BrowserSheet?
    @State private var scope: SidebarSelection?

    var body: some View {
        NavigationSplitView {
            ItemScopesList(scope: $scope)
                .navigationSplitViewColumnWidth(min: 220, ideal: 260, max: 320)
        } content: {
            if scope != nil {
                ItemsList(scope: Binding { scope ?? .allItems } set: { scope = $0 }, selection: $selection, sheet: $sheet)
                    .navigationSplitViewColumnWidth(min: 300, ideal: 360, max: 440)
            } else {
                ContentUnavailableView("Choose a Category", systemImage: "square.grid.2x2", description: Text("Pick a list on the left."))
            }
        } detail: {
            NavigationStack {
                if let item = model.item(id: selection) {
                    ItemDetailView(item: item, sheet: $sheet)
                } else {
                    ContentUnavailableView("No Item Selected", systemImage: "key.horizontal", description: Text("Choose an item to see its details."))
                        .background(Theme.background)
                }
            }
        }
        .navigationSplitViewStyle(.balanced)
        .onAppear {
            // iPad has room to show a list straight away.
            if sizeClass == .regular, scope == nil { scope = .allItems }
        }
        .onChange(of: scope) { old, _ in
            if old != nil { selection = nil }
        }
        // An item opened from elsewhere, such as a new one, needs a list to sit in.
        .onChange(of: selection) { _, id in
            if id != nil, scope == nil { scope = .allItems }
        }
    }
}
