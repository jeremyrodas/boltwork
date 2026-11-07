import BoltworkKit
import SwiftUI

/// The items with one kind of problem.
struct WatchtowerIssuesList: View {
    @Environment(AppModel.self) private var model
    let check: WatchtowerCheck
    let issues: [WatchtowerIssue]

    var body: some View {
        List(issues) { issue in
            if let item = model.item(id: issue.itemId) {
                NavigationLink(value: ItemRoute(id: item.id)) {
                    WatchtowerIssueRow(item: item, detail: issue.detail)
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background(Theme.background)
        .navigationTitle(check.title)
    }
}
