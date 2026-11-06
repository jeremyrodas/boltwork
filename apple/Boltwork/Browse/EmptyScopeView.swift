import SwiftUI

/// What an empty list says, depending on what it lists.
struct EmptyScopeView: View {
    let scope: SidebarSelection

    var body: some View {
        switch scope {
        case .favorites:
            ContentUnavailableView("No Favorites", systemImage: "star", description: Text("Mark items you use often as favorites to find them here."))
        case .archive:
            ContentUnavailableView("Archive Is Empty", systemImage: "archivebox", description: Text("Archived items stay in your vault but out of the way."))
        case .recentlyDeleted:
            ContentUnavailableView("Nothing Deleted", systemImage: "trash", description: Text("Deleted items stay here until you remove them for good."))
        default:
            ContentUnavailableView("No Items", systemImage: "key.horizontal", description: Text("Add a login, card, note or anything else you want to keep safe."))
        }
    }
}
