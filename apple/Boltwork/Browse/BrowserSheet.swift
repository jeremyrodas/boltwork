import BoltworkKit

/// Sheets the vault browser can show.
enum BrowserSheet: Identifiable, Equatable {
    case newItem(ItemCategory)
    case edit(Item)
    case generator
    case settings

    var id: String {
        switch self {
        case .newItem(let c): "new-\(c.rawValue)"
        case .edit(let item): "edit-\(item.id)"
        case .generator: "generator"
        case .settings: "settings"
        }
    }
}
