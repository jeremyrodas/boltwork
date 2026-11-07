import BoltworkKit
import SwiftUI

/// The Items tab: the list beside the selected item on iPad, a stack on iPhone.
struct ItemsBrowser: View {
    @Environment(AppModel.self) private var model
    @Binding var selection: String?
    @Binding var sheet: BrowserSheet?
    @State private var scope = SidebarSelection.allItems

    var body: some View {
        NavigationSplitView {
            ItemsList(scope: $scope, selection: $selection, sheet: $sheet)
                .navigationSplitViewColumnWidth(min: 300, ideal: 360, max: 440)
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
        .onChange(of: scope) { selection = nil }
    }
}
