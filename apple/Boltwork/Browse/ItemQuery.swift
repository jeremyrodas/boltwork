import BoltworkKit
import Foundation

/// Filters, searches and sorts items for the list.
struct ItemQuery {
    var scope: SidebarSelection
    var search = ""
    var sort = ItemSort.title

    func apply(to items: [Item]) -> [Item] {
        let terms = search.split(separator: " ").map(String.init)
        return items
            .filter(inScope)
            .filter { item in terms.allSatisfy { matches(item, $0) } }
            .sorted(by: ordered)
    }

    private func inScope(_ item: Item) -> Bool {
        switch scope {
        case .archive: return item.state == .archived
        case .recentlyDeleted: return item.state == .deleted
        default: break
        }
        guard item.state == .active else { return false }
        return switch scope {
        case .allItems, .watchtower: true
        case .favorites: item.favorite
        case .category(let c): item.category == c
        case .vault(let id): item.vaultId == id
        case .tag(let tag): item.content.tags.contains { $0 == tag || $0.hasPrefix("\(tag)/") }
        case .archive, .recentlyDeleted: false
        }
    }

    /// Plain words match the title, subtitle, websites, tags and notes. `tag:` and `url:` narrow the search.
    private func matches(_ item: Item, _ term: String) -> Bool {
        let c = item.content
        if term.hasPrefix("tag:") { return c.tags.contains { $0.localizedStandardContains(term.dropFirst(4)) } }
        if term.hasPrefix("url:") { return c.urls.contains { $0.url.localizedStandardContains(term.dropFirst(4)) } }
        if term == "is:favorite" { return item.favorite }
        if term == "has:otp" { return c.allFields.contains { $0.type == .totp && !$0.value.isEmpty } }
        return c.title.localizedStandardContains(term)
            || c.subtitle.localizedStandardContains(term)
            || c.urls.contains { $0.url.localizedStandardContains(term) }
            || c.tags.contains { $0.localizedStandardContains(term) }
            || c.notes.localizedStandardContains(term)
    }

    private func ordered(_ a: Item, _ b: Item) -> Bool {
        switch sort {
        case .title: a.title.localizedStandardCompare(b.title) == .orderedAscending
        case .dateModified: a.updatedAt > b.updatedAt
        case .dateCreated: a.createdAt > b.createdAt
        case .frequentlyUsed: a.useCount != b.useCount ? a.useCount > b.useCount : a.title.localizedStandardCompare(b.title) == .orderedAscending
        }
    }
}
