import BoltworkKit
import SwiftUI

/// Everything in one item, with copy buttons, live one-time codes, attachments and history.
struct ItemDetailView: View {
    @Environment(AppModel.self) private var model
    let item: Item
    @Binding var sheet: BrowserSheet?
    @State private var confirmingPurge = false

    private var content: ItemContent { item.content }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                ItemHeader(item: item, vaultName: model.vaults.count > 1 ? model.vault(id: item.vaultId)?.name : nil)
                let fields = content.fields.filter { !$0.value.isEmpty }
                if !fields.isEmpty {
                    DetailCard {
                        ForEach(fields) { row(for: $0) }
                    }
                }
                ForEach(content.sections) { section in
                    let sectionFields = section.fields.filter { !$0.value.isEmpty }
                    if !sectionFields.isEmpty {
                        VStack(alignment: .leading, spacing: 6) {
                            if !section.title.isEmpty {
                                Text(section.title)
                                    .font(.footnote.weight(.semibold))
                                    .foregroundStyle(.secondary)
                                    .padding(.leading, 16)
                            }
                            DetailCard {
                                ForEach(sectionFields) { row(for: $0) }
                            }
                        }
                    }
                }
                ForEach(content.urls, id: \.url) { url in
                    DetailPlainField(label: url.label.isEmpty ? "website" : url.label.lowercased()) {
                        HStack {
                            if let link = Domain.openableURL(url.url) {
                                Link(url.url, destination: link).lineLimit(1)
                            } else {
                                Text(url.url).lineLimit(1)
                            }
                            Spacer(minLength: 0)
                            CopyButton(value: url.url, label: "Copy Website")
                        }
                    }
                }
                if !content.notes.isEmpty {
                    DetailPlainField(label: "notes") {
                        Text(content.notes).textSelection(.enabled)
                    }
                }
                if !content.tags.isEmpty {
                    DetailPlainField(label: "tags") {
                        TagChips(tags: content.tags)
                    }
                }
                if item.passkeyCount > 0 {
                    DetailPlainField(label: "passkeys") {
                        Label("^[\(item.passkeyCount) passkey](inflect: true), used through the desktop browser extension", systemImage: "person.badge.key")
                    }
                }
                VStack(alignment: .leading, spacing: 4) {
                    AttachmentsSection(item: item)
                }
                .padding(.horizontal, 16)
                VStack(alignment: .leading, spacing: 6) {
                    Text("Modified \(item.updatedDate.formatted(date: .abbreviated, time: .shortened)) · Created \(item.createdDate.formatted(date: .abbreviated, time: .omitted))")
                    if !item.history.isEmpty {
                        NavigationLink(value: ItemHistoryRoute(itemID: item.id)) {
                            Label("^[\(item.history.count) earlier version](inflect: true)", systemImage: "clock.arrow.circlepath")
                        }
                    }
                }
                .font(.footnote)
                .foregroundStyle(.secondary)
                .padding(.horizontal, 16)
            }
            .padding()
            .frame(maxWidth: 720)
            .frame(maxWidth: .infinity)
        }
        .background(Theme.background)
        .navigationTitle(item.title)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .navigationDestination(for: ItemHistoryRoute.self) { route in
            ItemHistoryView(itemID: route.itemID)
        }
        .toolbar {
            if item.state == .deleted {
                ToolbarItem(placement: .primaryAction) {
                    Button("Restore", systemImage: "arrow.uturn.backward") { model.restore(item) }
                }
                ToolbarItem {
                    Button("Delete Permanently", systemImage: "trash", role: .destructive) { confirmingPurge = true }
                        .confirmationDialog("Delete “\(item.title)” permanently?", isPresented: $confirmingPurge) {
                            Button("Delete Permanently", role: .destructive) { model.purge(item) }
                        } message: {
                            Text("You can’t undo this.")
                        }
                }
            } else {
                ToolbarItem(placement: .primaryAction) {
                    Button("Edit", systemImage: "pencil") { sheet = .edit(item) }
                        .keyboardShortcut("e")
                }
                ToolbarItem {
                    ItemMoreMenu(item: item)
                }
            }
        }
    }
}

extension ItemDetailView {
    @ViewBuilder private func row(for field: Field) -> some View {
        if field.type == .totp {
            DetailCodeRow(label: field.label, secret: field.value)
        } else {
            DetailFieldRow(field: field, item: item)
        }
    }
}

/// Lets the detail stack push an item's history.
struct ItemHistoryRoute: Hashable {
    let itemID: String
}
