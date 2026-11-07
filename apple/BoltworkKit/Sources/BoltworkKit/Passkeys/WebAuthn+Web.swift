import Foundation

/// The relying-party half of passkeys on web pages, for the browser extension: checks the page may use a
/// relying party ID, builds the client data, and answers as the browser would (`src/core/passkeys.ts`).
extension WebAuthn {
    /// A WebAuthn failure to raise in the page as a DOMException.
    public struct PageError: Error, Equatable {
        public let name: String
        public let message: String
        public init(_ name: String, _ message: String) {
            self.name = name
            self.message = message
        }
    }

    public struct PageOrigin: Sendable {
        public let origin: String
        public let host: String
    }

    /// The page origin the browser reported, if it may use passkeys at all: https, or http on localhost.
    public static func checkOrigin(_ url: String) throws -> PageOrigin {
        guard let c = URLComponents(string: url), let scheme = c.scheme?.lowercased(), let host = c.host?.lowercased(), !host.isEmpty else {
            throw PageError("SecurityError", "This page has no usable address.")
        }
        let local = host == "localhost" || host.hasSuffix(".localhost")
        guard scheme == "https" || (scheme == "http" && local) else { throw PageError("SecurityError", "Passkeys need a secure (https) page.") }
        let defaultPort = scheme == "https" ? 443 : 80
        let port = c.port.flatMap { $0 == defaultPort ? nil : ":\($0)" } ?? ""
        let shownHost = host.contains(":") ? "[\(host)]" : host
        return PageOrigin(origin: "\(scheme)://\(shownHost)\(port)", host: host)
    }

    /// The relying party ID a page may use: its own host or a registrable parent of it, never a public suffix.
    public static func checkRpId(_ o: PageOrigin, requested: String?) throws -> String {
        let rpId = (requested ?? o.host).lowercased()
        guard rpId == o.host || o.host.hasSuffix(".\(rpId)") else { throw PageError("SecurityError", "This page can’t use passkeys for \(rpId).") }
        if rpId == "localhost" || rpId.hasSuffix(".localhost") { return rpId }
        if rpId.contains(":") || rpId.split(separator: ".").allSatisfy({ Int($0) != nil }) {
            guard rpId == o.host else { throw PageError("SecurityError", "Bad relying party.") }
            return rpId
        }
        guard PublicSuffix.registrableDomain(rpId) != nil else { throw PageError("SecurityError", "\(rpId) isn’t a domain a site can own.") }
        return rpId
    }

    /// `{type, challenge, origin, crossOrigin}`, in the order the WebAuthn spec serializes them.
    static func clientDataJSON(type: String, challenge: String, origin: String) -> [UInt8] {
        func quoted(_ s: String) -> String {
            String(decoding: (try? JSONSerialization.data(withJSONObject: s, options: .fragmentsAllowed)) ?? Data("\"\"".utf8), as: UTF8.self)
                .replacing("\\/", with: "/")
        }
        return Array("{\"type\":\(quoted(type)),\"challenge\":\(quoted(challenge)),\"origin\":\(quoted(origin)),\"crossOrigin\":false}".utf8)
    }

    static func validChallenge(_ value: JSONValue?) throws -> String {
        guard let c = value?.stringValue, (fromBase64URL(c)?.count ?? 0) >= 16 else { throw PageError("NotAllowedError", "The site sent a bad challenge.") }
        return c
    }

    /// Makes a passkey for a page's `navigator.credentials.create` request. The caller asks the user first and saves it.
    public static func createForPage(_ request: JSONValue, origin o: PageOrigin) throws -> (passkey: Passkey, response: JSONValue) {
        let rpId = try checkRpId(o, requested: request["rp"]?["id"]?.stringValue)
        let params = request["pubKeyCredParams"]?.arrayValue ?? []
        guard params.contains(where: { $0["type"]?.stringValue == "public-key" && $0["alg"]?.numberValue == -7 }) else {
            throw PageError("NotSupportedError", "This site doesn’t accept the passkey type Boltwork makes.")
        }
        let challenge = try validChallenge(request["challenge"])
        guard let userID = fromBase64URL(request["user"]?["id"]?.text ?? "") else { throw PageError("NotAllowedError", "The site sent a bad user ID.") }
        let made: NewCredential
        do {
            made = try newCredential(rpId: rpId, rpName: request["rp"]?["name"]?.stringValue, userHandle: userID,
                                     userName: request["user"]?["name"]?.text ?? "", userDisplayName: request["user"]?["displayName"]?.stringValue)
        } catch {
            throw PageError("NotAllowedError", error.localizedDescription)
        }
        let id = made.passkey.credentialId
        let credProps = request["extensions"]?["credProps"]?.boolValue == true
        let response: JSONValue = [
            "id": .string(id), "rawId": .string(id), "type": "public-key", "authenticatorAttachment": "platform",
            "response": [
                "clientDataJSON": .string(base64URL(clientDataJSON(type: "webauthn.create", challenge: challenge, origin: o.origin))),
                "attestationObject": .string(base64URL(made.attestationObject)),
                "authenticatorData": .string(base64URL(made.authenticatorData)),
                "publicKey": .string(base64URL(made.publicKeySPKI)),
                "publicKeyAlgorithm": -7,
                "transports": ["hybrid", "internal"],
            ],
            "clientExtensionResults": credProps ? ["credProps": ["rk": true]] : [:],
        ]
        return (made.passkey, response)
    }

    /// Which of these passkeys a page's `navigator.credentials.get` request may use.
    public static func usable<T>(_ all: [T], passkey: (T) -> Passkey, request: JSONValue, origin o: PageOrigin) throws -> [T] {
        let rpId = try checkRpId(o, requested: request["rpId"]?.stringValue)
        let allowed = Set((request["allowCredentials"]?.arrayValue ?? []).compactMap { $0["id"]?.stringValue })
        return all.filter { passkey($0).rpId == rpId && (allowed.isEmpty || allowed.contains(passkey($0).credentialId)) }
    }

    /// Signs a page in with a passkey the user picked.
    public static func assertForPage(_ passkey: Passkey, request: JSONValue, origin o: PageOrigin) throws -> JSONValue {
        let rpId = try checkRpId(o, requested: request["rpId"]?.stringValue)
        let challenge = try validChallenge(request["challenge"])
        let clientData = clientDataJSON(type: "webauthn.get", challenge: challenge, origin: o.origin)
        let signed: (authenticatorData: [UInt8], signature: [UInt8])
        do {
            signed = try assert(passkey, rpId: rpId, clientDataHash: sha256(clientData))
        } catch {
            throw PageError("NotAllowedError", error.localizedDescription)
        }
        return [
            "id": .string(passkey.credentialId), "rawId": .string(passkey.credentialId), "type": "public-key", "authenticatorAttachment": "platform",
            "response": [
                "clientDataJSON": .string(base64URL(clientData)), "authenticatorData": .string(base64URL(signed.authenticatorData)),
                "signature": .string(base64URL(signed.signature)), "userHandle": .string(passkey.userHandle),
            ],
            "clientExtensionResults": [:],
        ]
    }
}
