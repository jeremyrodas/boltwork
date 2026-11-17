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
                if passkeys.isEmpty {
                    Section { NoPasskeyNotice(site: parameters.relyingPartyIdentifier, others: session.passkeyCount(forSite: parameters.relyingPartyIdentifier)) }
                } else {
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
            Section(query.isEmpty ? (passkeyParameters == nil ? "All Logins" : "Or Use a Password") : "Results") { rows(searchResults) }
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

/// Why a site's passkey request has nothing to pick, instead of silently showing only passwords.
private struct NoPasskeyNotice: View {
    let site: String
    /// Passkeys Boltwork has for the site that the site didn't ask for.
    let others: Int

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Label(others == 0 ? "No passkey for \(site)" : "Not the passkey \(site) asked for", systemImage: "person.badge.key")
                .font(.headline)
            Text(others == 0
                 ? "Boltwork doesn’t have a passkey for this site. If you made it with another app, on a security key or on a phone, use that instead. If you saved it in Boltwork on another device, open Boltwork there and let it sync."
                 : "Boltwork has a passkey for this site, but the site asked for a different one, perhaps a security key or a passkey saved in another app.")
                .font(.subheadline).foregroundStyle(.secondary)
        }
        .padding(.vertical, 4)
    }
}

/// Picks a login's verification code for the page or app being filled.
struct CodePicker: View {
    let session: AutoFillSession
    let services: [ASCredentialServiceIdentifier]
    @State private var query = ""

    var body: some View {
        List {
            let suggested = session.codeLogins(matching: services)
            if query.isEmpty, !suggested.isEmpty {
                Section("Suggested") { rows(suggested) }
            }
            Section(query.isEmpty ? "All Verification Codes" : "Results") { rows(searchResults) }
        }
        .searchable(text: $query, prompt: "Search logins")
        .navigationTitle("Boltwork")
        .overlay {
            if !query.isEmpty, searchResults.isEmpty { ContentUnavailableView.search(text: query) }
            else if query.isEmpty, session.allCodeLogins.isEmpty {
                ContentUnavailableView("No Verification Codes", systemImage: "clock.badge.checkmark",
                                       description: Text("Logins with a one-time password show up here."))
            }
        }
    }

    private var searchResults: [Item] {
        guard !query.isEmpty else { return session.allCodeLogins }
        return session.allCodeLogins.filter { item in
            item.title.localizedStandardContains(query) || item.content.urls.contains { $0.url.localizedStandardContains(query) }
        }
    }

    private func rows(_ items: [Item]) -> some View {
        ForEach(items) { item in
            Button {
                session.fillCode(item)
            } label: {
                CredentialRow(title: item.title, detail: item.content.field(for: .username)?.value ?? "", systemImage: "clock.badge.checkmark")
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
