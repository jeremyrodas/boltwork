import AuthenticationServices
import BoltworkKit
import SwiftUI

/// Picks a login, or a passkey when the site asked for one, for the page or app being filled.
struct CredentialPicker: View {
    let session: AutoFillSession
    let services: [ASCredentialServiceIdentifier]
    let passkeyParameters: ASPasskeyCredentialRequestParameters?
    @State private var query = ""

    var body: some View {
        List {
            if let parameters = passkeyParameters, query.isEmpty {
                let passkeys = session.passkeys(for: parameters)
                if !passkeys.isEmpty {
                    Section("Passkeys") {
                        ForEach(passkeys, id: \.passkey.credentialId) { match in
                            Button {
                                session.signIn(with: match.passkey, itemId: match.item.id, clientDataHash: parameters.clientDataHash)
                            } label: {
                                CredentialRow(title: match.item.title, detail: match.passkey.userName, systemImage: "person.badge.key")
                            }
                        }
                    }
                }
            }
            let suggested = session.logins(matching: services)
            if query.isEmpty, !suggested.isEmpty {
                Section("Suggested") { rows(suggested) }
            }
            Section(query.isEmpty ? "All Logins" : "Results") { rows(searchResults) }
        }
        .searchable(text: $query, prompt: "Search logins")
        .navigationTitle("Boltwork")
        .overlay {
            if !query.isEmpty, searchResults.isEmpty { ContentUnavailableView.search(text: query) }
        }
    }

    private var searchResults: [Item] {
        guard !query.isEmpty else { return session.allLogins }
        return session.allLogins.filter { item in
            item.title.localizedStandardContains(query)
                || (item.content.field(for: .username)?.value ?? "").localizedStandardContains(query)
                || item.content.urls.contains { $0.url.localizedStandardContains(query) }
        }
    }

    private func rows(_ items: [Item]) -> some View {
        ForEach(items) { item in
            Button {
                session.fill(item)
            } label: {
                CredentialRow(title: item.title, detail: item.content.field(for: .username)?.value ?? "", systemImage: "key")
            }
        }
    }
}

private struct CredentialRow: View {
    let title: String
    let detail: String
    let systemImage: String

    var body: some View {
        Label {
            VStack(alignment: .leading) {
                Text(title).foregroundStyle(.primary)
                if !detail.isEmpty { Text(detail).font(.subheadline).foregroundStyle(.secondary) }
            }
        } icon: {
            Image(systemName: systemImage).foregroundStyle(Theme.accent)
        }
    }
}
