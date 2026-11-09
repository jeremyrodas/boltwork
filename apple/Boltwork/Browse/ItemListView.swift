import BoltworkKit
import SwiftUI

/// The items in the chosen scope, searchable and sortable.
struct ItemListView: View {
    @Environment(AppModel.self) private var model
    let scope: SidebarSelection
    @Binding var selection: String?
    @Binding var sheet: BrowserSheet?
    @State private var search = ""
    @State private var confirmingEmptyTrash = false
    @AppStorage(AppSettings.itemSort) private var sort = ItemSort.title

    private var items: [Item] { ItemQuery(scope: scope, search: search, sort: sort).apply(to: model.items) }

    var body: some View {
        let items = items
        List(selection: $selection) {
            ForEach(items) { item in
                ItemRow(item: item)
                    .tag(item.id)
                    .contextMenu { ItemActions(item: item) }
                    .swipeActions(edge: .trailing) {
                        if item.state != .deleted {
                            Button("Delete", systemImage: "trash", role: .destructive) { model.trash(item) }
                        }
                    }
                    .swipeActions(edge: .leading) {
                        if item.state == .active {
                            Button(item.favorite ? "Unfavorite" : "Favorite", systemImage: item.favorite ? "star.slash" : "star") {
                                model.setFavorite(item, !item.favorite)
                            }
                            .tint(.yellow)
                        }
                    }
            }
        }
        .overlay {
            if items.isEmpty {
                if search.isEmpty {
                    EmptyScopeView(scope: scope)
                } else {
                    ContentUnavailableView.search
                }
            }
        }
        .searchable(text: $search, prompt: "Search")
        .navigationTitle(title)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                NewItemMenu(sheet: $sheet)
            }
            ToolbarItem {
                Menu("Sort", systemImage: "arrow.up.arrow.down") {
                    Picker("Sort By", selection: $sort) {
                        ForEach(ItemSort.allCases) { Text($0.label).tag($0) }
                    }
                }
            }
            if scope == .recentlyDeleted && !items.isEmpty {
                ToolbarItem {
                    Button("Empty", systemImage: "trash.slash") { confirmingEmptyTrash = true }
                        .confirmationDialog("Permanently delete all items in Recently Deleted?", isPresented: $confirmingEmptyTrash) {
                            Button("Delete All", role: .destructive, action: model.emptyTrash)
                        } message: {
                            Text("You can’t undo this. It also removes them from your other devices.")
                        }
                }
            }
        }
    }

    private var title: String {
        switch scope {
        case .allItems, .watchtower: "All Items"
        case .favorites: "Favorites"
        case .archive: "Archive"
        case .recentlyDeleted: "Recently Deleted"
        case .category(let c): c.displayName
        case .vault(let id): model.vault(id: id)?.name ?? "Vault"
        case .tag(let tag): tag
        }
    }
}
