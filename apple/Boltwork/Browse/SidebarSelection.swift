import BoltworkKit

/// What the sidebar shows in the middle column.
enum SidebarSelection: Hashable {
    case allItems, favorites, watchtower, archive, recentlyDeleted
    case category(ItemCategory)
    case vault(String)
    case tag(String)
}
