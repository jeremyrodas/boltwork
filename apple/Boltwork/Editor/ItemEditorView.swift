import BoltworkKit
import SwiftUI

/// Creating or editing an item. Changes are only saved on Save; the previous version goes into history.
struct ItemEditorView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @Binding private var selection: String?

    private let itemID: String?
    @State private var content: ItemContent
    @State private var vaultID: String
    @State private var urls: [EditableURL]
    @State private var tagsText: String
    @State private var confirmingDiscard = false
    private let original: ItemContent

    init(newItemOf category: ItemCategory, defaultVaultID: String, selection: Binding<String?>) {
        let blank = ItemTemplate.blankContent(category)
        itemID = nil
        original = blank
        _selection = selection
        _content = State(initialValue: blank)
        _vaultID = State(initialValue: defaultVaultID)
        _urls = State(initialValue: category.template.hasURLs ? [EditableURL()] : [])
        _tagsText = State(initialValue: "")
    }

    init(editing item: Item, selection: Binding<String?>) {
        itemID = item.id
        original = item.content
        _selection = selection
        _content = State(initialValue: item.content)
        _vaultID = State(initialValue: item.vaultId)
        _urls = State(initialValue: item.content.urls.map(EditableURL.init))
        _tagsText = State(initialValue: item.content.tags.joined(separator: ", "))
    }

    private var edited: ItemContent {
        var c = content
        c.urls = urls.map(\.itemURL).filter { !$0.url.isEmpty }
        c.tags = tagsText.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        return c
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Title", text: $content.title, prompt: Text(content.category.displayName))
                        .font(.title3)
                        .accessibilityLabel("Title")
                    if model.vaults.count > 1 {
                        Picker("Vault", selection: $vaultID) {
                            ForEach(model.vaults) { Text($0.name).tag($0.id) }
                        }
                    }
                }
                Section {
                    ForEach($content.fields) { $field in
                        EditableFieldRow(field: $field, isCustom: !content.category.template.fields.contains { $0.id == field.id })
                    }
                    .onDelete { content.fields.remove(atOffsets: $0) }
                    AddFieldMenu(fields: $content.fields)
                    if content.category == .sshKey {
                        SSHKeyActions(fields: $content.fields)
                    }
                }
                ForEach($content.sections) { $section in
                    Section(section.title) {
                        ForEach($section.fields) { $field in
                            EditableFieldRow(field: $field, isCustom: true)
                        }
                        .onDelete { section.fields.remove(atOffsets: $0) }
                    }
                }
                if content.category.template.hasURLs || !urls.isEmpty {
                    Section("Websites") {
                        ForEach($urls) { $url in
                            TextField("Website", text: $url.url, prompt: Text("example.com"))
                                .textContentType(.URL)
                                .keyboard(.url)
                                .plainTextEntry()
                        }
                        .onDelete { urls.remove(atOffsets: $0) }
                        Button("Add Website", systemImage: "plus") { urls.append(EditableURL()) }
                    }
                }
                Section("Notes") {
                    TextField("Notes", text: $content.notes, axis: .vertical)
                        .lineLimit(4...)
                }
                Section {
                    TextField("Tags", text: $tagsText, prompt: Text("work, finance/banks"))
                        .plainTextEntry()
                } header: {
                    Text("Tags")
                } footer: {
                    Text("Separate tags with commas. Use a slash to nest them.")
                }
            }
            .formStyle(.grouped)
            .navigationTitle(itemID == nil ? "New \(content.category.displayName)" : "Edit Item")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", action: cancel)
                        .confirmationDialog("Discard your changes?", isPresented: $confirmingDiscard) {
                            Button("Discard Changes", role: .destructive) { dismiss() }
                        }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save", action: save)
                        .keyboardShortcut("s")
                }
            }
            .interactiveDismissDisabled(edited != original)
        }
        #if os(macOS)
        .frame(minWidth: 480, minHeight: 560)
        #endif
    }

    private func cancel() {
        if edited != original { confirmingDiscard = true } else { dismiss() }
    }

    private func save() {
        guard let saved = model.saveItem(id: itemID, vaultId: vaultID, content: edited) else { return }
        selection = saved.id
        dismiss()
    }
}
