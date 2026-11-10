import Foundation

/// An `otpauth://` link a website or QR code hands to the app chosen for setting up verification codes.
public struct CodeSetupLink: Equatable, Sendable {
    public let link: String
    public let totp: TOTP

    public init(_ url: URL) throws {
        link = url.absoluteString
        totp = try TOTP(link)
    }

    /// What the site calls itself, for titles and finding the matching login.
    public var issuer: String? { totp.issuer.flatMap { $0.isEmpty ? nil : $0 } }
    public var account: String? { totp.account.flatMap { $0.isEmpty ? nil : $0 } }

    /// Logins that look like this code's account: the issuer in the title or a website, or the same username.
    public func isLikely(_ content: ItemContent) -> Bool {
        guard content.category == .login || content.category == .password else { return false }
        if let issuer = issuer?.lowercased() {
            let word = issuer.split(whereSeparator: { !$0.isLetter && !$0.isNumber }).first.map(String.init) ?? issuer
            if content.title.lowercased().contains(word) || content.urls.contains(where: { $0.url.lowercased().contains(word) }) { return true }
        }
        if let account = account?.lowercased(), content.field(for: .username)?.value.lowercased() == account { return true }
        return false
    }

    /// The login with this code in its one-time password field, added if it has none.
    public func adding(to content: ItemContent) -> ItemContent {
        var c = content
        if let i = c.fields.firstIndex(where: { $0.purpose == .totp }) {
            c.fields[i].value = link
        } else if let s = c.sections.firstIndex(where: { $0.fields.contains { $0.purpose == .totp } }),
                  let i = c.sections[s].fields.firstIndex(where: { $0.purpose == .totp }) {
            c.sections[s].fields[i].value = link
        } else {
            c.fields.append(Field(id: "otp", label: "one-time password", type: .totp, value: link, purpose: .totp))
        }
        return c
    }

    /// A new login for this code, named after the site.
    public var newLogin: ItemContent {
        var c = ItemTemplate.blankContent(.login)
        c.title = issuer ?? account ?? "Verification Code"
        if let account, let i = c.fields.firstIndex(where: { $0.purpose == .username }) { c.fields[i].value = account }
        return adding(to: c)
    }
}
