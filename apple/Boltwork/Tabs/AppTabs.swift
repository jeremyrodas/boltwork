#if os(iOS)
import BoltworkKit
import SwiftUI

/// The unlocked vault on iPhone and iPad: Home, Items, Watchtower and Search tabs.
struct AppTabs: View {
    @Environment(AppModel.self) private var model
    @State private var tab = AppTab.home
    @State private var selectedItemID: String?
    @State private var sheet: BrowserSheet?
    @State private var creatingItem = false

    var body: some View {
        TabView(selection: $tab) {
            Tab("Home", systemImage: "house", value: AppTab.home) {
                NavigationStack {
                    HomeView(sheet: $sheet)
                        .itemDestinations(sheet: $sheet)
                }
            }
            Tab("Items", systemImage: "list.bullet.rectangle.portrait", value: AppTab.items) {
                ItemsBrowser(selection: $selectedItemID, sheet: $sheet)
            }
            Tab("Watchtower", systemImage: "shield.lefthalf.filled", value: AppTab.watchtower) {
                NavigationStack {
                    WatchtowerDashboard(sheet: $sheet)
                        .itemDestinations(sheet: $sheet)
                }
            }
            Tab(value: AppTab.search, role: .search) {
                NavigationStack {
                    SearchTab(isSelected: tab == .search)
                        .itemDestinations(sheet: $sheet)
                }
            }
        }
        .browserSheets($sheet, selection: $selectedItemID, defaultVaultID: model.vaults.first?.id ?? "")
        // A new item opens in Items, wherever it was started.
        .onChange(of: sheet) { _, new in
            if case .newItem = new { creatingItem = true }
        }
        .onChange(of: selectedItemID) { _, id in
            if creatingItem, id != nil {
                creatingItem = false
                tab = .items
            }
        }
    }
}
#endif
