import BoltworkKit
import SwiftUI

/// Searches every item. Before typing, shows the most recently used.
struct SearchTab: View {
    /// Whether the Search tab is the selected one; choosing it puts the cursor in the search field.
    var isSelected: Bool

    @Environment(AppModel.self) private var model
    @State private var query = ""
    @FocusState private var fieldFocused: Bool

    var body: some View {
        let results = query.isEmpty
            ? Array(model.items.filter { $0.state == .active && $0.lastUsedAt != nil }.sorted { ($0.lastUsedAt ?? 0) > ($1.lastUsedAt ?? 0) }.prefix(10))
            : ItemQuery(scope: .allItems, search: query, sort: .frequentlyUsed).apply(to: model.items)
        List {
            Section {
                ForEach(results) { item in
                    NavigationLink(value: ItemRoute(id: item.id)) { ItemRow(item: item) }
                }
            } header: {
                if query.isEmpty && !results.isEmpty { Text("Recently Used") }
            }
        }
        .scrollContentBackground(.hidden)
        .background(Theme.background)
        .overlay {
            if !query.isEmpty && results.isEmpty {
                ContentUnavailableView.search(text: query)
            } else if query.isEmpty && results.isEmpty {
                ContentUnavailableView("Search Your Vault", systemImage: "magnifyingglass", description: Text("Find items by title, username, website, tag or note."))
            }
        }
        .scrollDismissesKeyboard(.immediately)
        // Always on screen: the system search bar hides itself on iPhone and collapses to a button on iPad.
        .safeAreaInset(edge: .top) { searchField }
        .task(id: isSelected) {
            // Focusing during the tab switch is ignored; wait for the field to be on screen.
            guard isSelected else { return }
            try? await Task.sleep(for: .milliseconds(150))
            fieldFocused = true
        }
        .navigationTitle("Search")
    }

    private var searchField: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass").foregroundStyle(Theme.muted)
            TextField("Search all items", text: $query)
                .focused($fieldFocused)
                #if os(iOS)
                .textInputAutocapitalization(.never)
                #endif
                .autocorrectionDisabled()
                .submitLabel(.search)
            if !query.isEmpty {
                Button("Clear", systemImage: "xmark.circle.fill") { query = "" }
                    .labelStyle(.iconOnly)
                    .foregroundStyle(Theme.muted)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 11)
        .background(Theme.card, in: .capsule)
        .overlay(Capsule().strokeBorder(Theme.line))
        .padding(.horizontal)
        .padding(.bottom, 8)
        .background(Theme.background)
    }
}
