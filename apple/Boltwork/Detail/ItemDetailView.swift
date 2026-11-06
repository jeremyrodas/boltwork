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
        Form {
            Section {
                ItemHeader(item: item, vaultName: model.vaults.count > 1 ? model.vault(id: item.vaultId)?.name : nil)
            }
            let fields = content.fields.filter { !$0.value.isEmpty }
            if !fields.isEmpty {
                Section {
                    ForEach(fields) { FieldRow(field: $0, item: item) }
                }
            }
            ForEach(content.sections) { section in
                let sectionFields = section.fields.filter { !$0.value.isEmpty }
                if !sectionFields.isEmpty {
                    Section(section.title) {
                        ForEach(sectionFields) { FieldRow(field: $0, item: item) }
                    }
                }
            }
            if !content.urls.isEmpty {
                Section(content.urls.count == 1 ? "Website" : "Websites") {
                    ForEach(content.urls, id: \.url) { WebsiteRow(url: $0) }
                }
            }
            if !content.notes.isEmpty {
                Section("Notes") {
                    Text(content.notes)
                        .textSelection(.enabled)
                }
            }
            if !content.tags.isEmpty {
                Section("Tags") {
                    Text(content.tags.formatted())
                }
            }
            if item.passkeyCount > 0 {
                Section {
                    Label("^[\(item.passkeyCount) passkey](inflect: true)", systemImage: "person.badge.key")
                } footer: {
                    Text("Passkeys sign you in on the desktop through the Boltwork browser extension.")
                }
            }
            AttachmentsSection(item: item)
            Section {
                LabeledContent("Modified", value: item.updatedDate.formatted(date: .abbreviated, time: .shortened))
                LabeledContent("Created", value: item.createdDate.formatted(date: .abbreviated, time: .shortened))
                if !item.history.isEmpty {
                    NavigationLink(value: ItemHistoryRoute(itemID: item.id)) {
                        Label("^[\(item.history.count) earlier version](inflect: true)", systemImage: "clock.arrow.circlepath")
                    }
                }
            }
            .foregroundStyle(.secondary)
        }
        .formStyle(.grouped)
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

/// Lets the detail stack push an item's history.
struct ItemHistoryRoute: Hashable {
    let itemID: String
}
