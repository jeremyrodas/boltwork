import BoltworkKit
import SwiftUI

/// The unlocked vault: sidebar, item list and item detail. Collapses to a stack on narrow screens.
struct VaultBrowser: View {
    @Environment(AppModel.self) private var model
    @State private var sidebar: SidebarSelection? = .allItems
    @State private var selectedItemID: String?
    @State private var sheet: BrowserSheet?

    var body: some View {
        NavigationSplitView {
            SidebarView(selection: $sidebar, sheet: $sheet)
                .navigationSplitViewColumnWidth(min: 200, ideal: 240)
        } content: {
            if sidebar == .watchtower {
                WatchtowerView(selection: $selectedItemID)
            } else {
                ItemListView(scope: sidebar ?? .allItems, selection: $selectedItemID, sheet: $sheet)
            }
        } detail: {
            NavigationStack {
                if let item = model.item(id: selectedItemID) {
                    ItemDetailView(item: item, sheet: $sheet)
                } else {
                    ContentUnavailableView("No Item Selected", systemImage: "key.horizontal", description: Text("Choose an item to see its details."))
                }
            }
        }
        .onChange(of: sidebar) {
            selectedItemID = nil
        }
        .browserSheets($sheet, selection: $selectedItemID, defaultVaultID: defaultVaultID)
    }

    /// New items go into the vault being browsed, or the first vault.
    private var defaultVaultID: String {
        if case .vault(let id) = sidebar { return id }
        return model.vaults.first?.id ?? ""
    }
}
