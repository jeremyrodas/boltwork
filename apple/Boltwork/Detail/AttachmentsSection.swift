import BoltworkKit
import QuickLook
import SwiftUI

/// An item's files: add, preview with Quick Look, remove.
struct AttachmentsSection: View {
    @Environment(AppModel.self) private var model
    let item: Item
    @State private var importing = false
    @State private var previewURL: URL?
    @State private var removing: Attachment?

    var body: some View {
        Section("Attachments") {
            ForEach(item.attachments) { attachment in
                AttachmentRow(attachment: attachment, open: { open(attachment) }, remove: { removing = attachment })
            }
            if item.state != .deleted {
                Button("Add File…", systemImage: "paperclip") { importing = true }
            }
        }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.item], onCompletion: imported)
        .quickLookPreview($previewURL)
        .confirmationDialog("Remove this file?", item: $removing) { attachment in
            Button("Remove “\(attachment.name)”", role: .destructive) { model.removeAttachment(attachment, from: item) }
        }
    }

    private func open(_ attachment: Attachment) {
        previewURL = model.previewURL(for: attachment, in: item)
    }

    private func imported(_ result: Result<URL, any Error>) {
        if case .success(let url) = result { model.addAttachment(to: item, from: url) }
    }
}
