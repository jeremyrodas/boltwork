import BoltworkKit
import SwiftUI

/// The first tab: live one-time codes, then favorites and recent items in cards.
struct HomeView: View {
    @Environment(AppModel.self) private var model
    @Binding var sheet: BrowserSheet?

    private var active: [Item] { model.items.filter { $0.state == .active } }

    var body: some View {
        let active = active
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                let codes = Self.withCodes(active)
                if !codes.isEmpty {
                    OneTimeCodeStrip(items: codes)
                }
                if active.isEmpty {
                    HomeWelcomeCard(sheet: $sheet)
                }
                HomeSection(title: "Favorites", symbol: "star.fill", tint: .yellow,
                            items: active.filter(\.favorite).sorted { $0.title.localizedStandardCompare($1.title) == .orderedAscending })
                HomeSection(title: "Recently Used", symbol: "clock.fill", tint: Theme.brass,
                            items: Array(active.filter { $0.lastUsedAt != nil }.sorted { ($0.lastUsedAt ?? 0) > ($1.lastUsedAt ?? 0) }.prefix(6)))
                HomeSection(title: "Recently Created", symbol: "sparkles", tint: .teal,
                            items: Array(active.sorted { $0.createdAt > $1.createdAt }.prefix(6)))
                SyncStatusFooter()
            }
            .padding()
            .frame(maxWidth: 960)
            .frame(maxWidth: .infinity)
        }
        .background(Theme.background)
        .navigationTitle("Home")
        .navigationSubtitle(subtitle)
        .toolbar {
            #if os(iOS)
            ToolbarItem(placement: .topBarLeading) {
                AccountMenu(sheet: $sheet)
            }
            #endif
            ToolbarItem(placement: .primaryAction) {
                NewItemMenu(sheet: $sheet)
            }
        }
    }

    private var subtitle: Text {
        model.vaults.count == 1 ? Text(model.vaults[0].name) : Text("^[\(model.vaults.count) vault](inflect: true)")
    }

    /// Items with a one-time code, favorites first, then the most used.
    static func withCodes(_ items: [Item]) -> [Item] {
        items
            .filter { $0.content.allFields.contains { $0.type == .totp && !$0.value.isEmpty } }
            .sorted { ($0.favorite ? 1 : 0, $0.useCount) > ($1.favorite ? 1 : 0, $1.useCount) }
            .prefix(12)
            .map(\.self)
    }
}
