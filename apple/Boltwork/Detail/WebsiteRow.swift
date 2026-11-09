import BoltworkKit
import SwiftUI

struct WebsiteRow: View {
    let url: ItemURL

    var body: some View {
        LabeledContent {
            HStack(spacing: 4) {
                if let link = Domain.openableURL(url.url) {
                    Link(url.url, destination: link).lineLimit(1)
                } else {
                    Text(url.url)
                }
                CopyButton(value: url.url, label: "Copy Website")
            }
        } label: {
            Text(url.label.isEmpty ? "website" : url.label)
        }
    }
}
