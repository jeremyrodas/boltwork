import BoltworkKit
import SwiftUI

/// Item scopes: everything, favorites, Watchtower, categories, vaults, tags, archive and trash.
struct SidebarView: View {
    @Environment(AppModel.self) private var model
    @Binding var selection: SidebarSelection?
    @Binding var sheet: BrowserSheet?

    private var activeItems: [Item] { model.items.filter { $0.state == .active } }
    private var categories: [ItemCategory] {
        let used = Set(activeItems.map(\.category))
        return ItemCategory.allCases.filter(used.contains)
    }

    var body: some View {
        List(selection: $selection) {
            Section {
                SidebarRow(title: "All Items", symbol: "square.grid.2x2", count: activeItems.count)
                    .tag(SidebarSelection.allItems)
                SidebarRow(title: "Favorites", symbol: "star", count: activeItems.count { $0.favorite })
                    .tag(SidebarSelection.favorites)
                SidebarRow(title: "Watchtower", symbol: "shield.lefthalf.filled", count: nil)
                    .tag(SidebarSelection.watchtower)
            }
            if !categories.isEmpty {
                Section("Categories") {
                    ForEach(categories) { category in
                        SidebarRow(title: category.displayName, symbol: category.symbol, count: activeItems.count { $0.category == category })
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
        .navigationTitle("Boltwork")
        .safeAreaInset(edge: .bottom) {
            SyncStatusFooter()
        }
        .toolbar {
            ToolbarItemGroup {
                Button("Password Generator", systemImage: "wand.and.stars") { sheet = .generator }
                #if os(iOS)
                Button("Settings", systemImage: "gearshape") { sheet = .settings }
                #endif
                Button("Lock", systemImage: "lock", action: model.lock)
            }
        }
    }
}
