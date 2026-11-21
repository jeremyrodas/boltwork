import BoltworkKit
import SwiftUI

/// The Items tab's first page: All Items, Favorites, each category, vaults, tags, Archive and Recently Deleted,
/// with how many items each holds. Picking one shows its items.
struct ItemScopesList: View {
    @Environment(AppModel.self) private var model
    @Binding var scope: SidebarSelection?

    private var activeItems: [Item] { model.items.filter { $0.state == .active } }
    private var categories: [ItemCategory] {
        let used = Set(activeItems.map(\.category))
        return ItemCategory.allCases.filter(used.contains)
    }

    var body: some View {
        List(selection: $scope) {
            Section {
                SidebarRow(title: "All Items", symbol: "square.grid.2x2", count: activeItems.count)
                    .tag(SidebarSelection.allItems)
                SidebarRow(title: "Favorites", symbol: "star", count: activeItems.count { $0.favorite })
                    .tag(SidebarSelection.favorites)
            }
            if !categories.isEmpty {
                Section("Categories") {
                    ForEach(categories) { category in
                        SidebarRow(title: category.pluralName, symbol: category.symbol, count: activeItems.count { $0.category == category })
                            .tag(SidebarSelection.category(category))
                    }
                }
            }
            if model.vaults.count > 1 {
                Section("Vaults") {
                    ForEach(model.vaults) { vault in
                        SidebarRow(title: vault.name, symbol: "lock.square.stack", count: activeItems.count { $0.vaultId == vault.id })
                            .tag(SidebarSelection.vault(vault.id))
                    }
                }
            }
            if !model.allTags.isEmpty {
                Section("Tags") {
                    ForEach(model.allTags, id: \.self) { tag in
                        SidebarRow(title: tag, symbol: "tag", count: nil)
                            .tag(SidebarSelection.tag(tag))
                    }
                }
            }
            Section {
                SidebarRow(title: "Archive", symbol: "archivebox", count: model.items.count { $0.state == .archived })
                    .tag(SidebarSelection.archive)
                SidebarRow(title: "Recently Deleted", symbol: "trash", count: model.items.count { $0.state == .deleted })
                    .tag(SidebarSelection.recentlyDeleted)
            }
        }
        .navigationTitle("Items")
    }
}

extension ItemCategory {
    /// The category's name as a list heading: "Logins", "Identities", "SSH Keys".
    var pluralName: String {
        let name = displayName
        guard name.hasSuffix("y"), let before = name.dropLast().last, !"aeiouAEIOU".contains(before) else { return name + "s" }
        return name.dropLast() + "ies"
    }
}
