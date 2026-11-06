import SwiftUI

struct SidebarRow: View {
    let title: String
    let symbol: String
    let count: Int?

    var body: some View {
        Label(title, systemImage: symbol)
            .badge(count ?? 0)
    }
}
