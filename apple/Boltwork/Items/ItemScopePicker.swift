import BoltworkKit
import SwiftUI

/// Everything the Items list can show: all items, favorites, a category, vault or tag, archive or trash.
struct ItemScopePicker: View {
    @Environment(AppModel.self) private var model
    @Binding var scope: SidebarSelection

    private var categories: [ItemCategory] {
        let used = Set(model.items.filter { $0.state == .active }.map(\.category))
        return ItemCategory.allCases.filter(used.contains)
    }

    var body: some View {
        Picker("Show", selection: $scope) {
            Label("All Items", systemImage: "square.grid.2x2").tag(SidebarSelection.allItems)
            Label("Favorites", systemImage: "star").tag(SidebarSelection.favorites)
            if !categories.isEmpty {
                Section("Categories") {
                    ForEach(categories) { Label($0.displayName, systemImage: $0.symbol).tag(SidebarSelection.category($0)) }
                }
            }
            if model.vaults.count > 1 {
                Section("Vaults") {
                    ForEach(model.vaults) { Label($0.name, systemImage: "lock.square.stack").tag(SidebarSelection.vault($0.id)) }
                }
            }
            if !model.allTags.isEmpty {
                Section("Tags") {
                    ForEach(model.allTags, id: \.self) { Label($0, systemImage: "tag").tag(SidebarSelection.tag($0)) }
                }
            }
            Section {
                Label("Archive", systemImage: "archivebox").tag(SidebarSelection.archive)
                Label("Recently Deleted", systemImage: "trash").tag(SidebarSelection.recentlyDeleted)
            }
        }
        .pickerStyle(.inline)
    }
}
