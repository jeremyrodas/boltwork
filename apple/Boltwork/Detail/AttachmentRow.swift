import BoltworkKit
import SwiftUI

struct AttachmentRow: View {
    let attachment: Attachment
    let open: () -> Void
    let remove: () -> Void

    var body: some View {
        Button(action: open) {
            LabeledContent {
                Text(Int64(attachment.size), format: .byteCount(style: .file))
            } label: {
                Label(attachment.name, systemImage: "doc")
            }
        }
        .buttonStyle(.plain)
        .contextMenu {
            Button("Remove", systemImage: "trash", role: .destructive, action: remove)
        }
        .swipeActions {
            Button("Remove", systemImage: "trash", role: .destructive, action: remove)
        }
    }
}
