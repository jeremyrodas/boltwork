import BoltworkKit
import SwiftUI

extension CodeSetupLink: @retroactive Identifiable {
    public var id: String { link }
}

/// A verification code setup link or QR code opened with Boltwork: pick the login it belongs to, or make one.
struct CodeSetupSheet: View {
    let link: CodeSetupLink
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""

    var body: some View {
        NavigationStack {
            List {
                Section {
                    LabeledContent("Site", value: link.issuer ?? "Not named")
                    if let account = link.account { LabeledContent("Account", value: account) }
                } footer: {
                    Text("Choose the login this verification code is for. Boltwork fills the code when you sign in.")
                }
                Section {
                    Button("New Login for \(link.issuer ?? link.account ?? "This Code")", systemImage: "plus") { add(to: nil) }
                }
                if query.isEmpty, !suggested.isEmpty {
                    Section("Suggested") { rows(suggested) }
                }
                Section(query.isEmpty ? "All Logins" : "Results") { rows(results) }
            }
            .searchable(text: $query, prompt: "Search logins")
            .navigationTitle("Add Verification Code")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
        #if os(macOS)
        .frame(minWidth: 420, minHeight: 480)
        #endif
    }

    private var logins: [Item] {
        model.items.filter { $0.state == .active && ($0.category == .login || $0.category == .password) }
            .sorted { $0.title.localizedStandardCompare($1.title) == .orderedAscending }
    }

    private var suggested: [Item] { logins.filter { link.isLikely($0.content) } }

    private var results: [Item] {
        guard !query.isEmpty else { return logins }
        return logins.filter { item in
            item.title.localizedStandardContains(query)
                || (item.content.field(for: .username)?.value ?? "").localizedStandardContains(query)
                || item.content.urls.contains { $0.url.localizedStandardContains(query) }
        }
    }

    private func rows(_ items: [Item]) -> some View {
        ForEach(items) { item in
            Button { add(to: item.id) } label: {
                VStack(alignment: .leading) {
                    HStack {
                        Text(item.title).foregroundStyle(.primary)
                        if item.content.field(for: .totp) != nil {
                            Text("Has a code").font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    if let user = item.content.field(for: .username)?.value, !user.isEmpty {
                        Text(user).font(.subheadline).foregroundStyle(.secondary)
                    }
                }
            }
        }
    }

    private func add(to itemId: String?) {
        model.addCode(link, to: itemId)
        dismiss()
    }
}
