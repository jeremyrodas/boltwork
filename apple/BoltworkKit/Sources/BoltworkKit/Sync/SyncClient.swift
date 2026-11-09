import Foundation

/// Talks to a Boltwork sync server (`/api/v1`). Only sealed records, the wrapped master key and
/// KDF parameters ever leave the device.
public struct SyncClient: Sendable {
    public let serverURL: String
    public var token: String

    public init(serverURL: String, token: String = "") {
        self.serverURL = serverURL
        self.token = token
    }

    public struct Health: Decodable, Sendable { public let ok: Bool; public let signups: String? }
    public struct LoginResponse: Decodable, Sendable { public let token: String; public let accountId: String; public let kdf: KdfParams; public let wrappedKey: Sealed }
    public struct Device: Decodable, Sendable, Hashable { public let device: String; public let createdAt: Int64; public let lastUsedAt: Int64 }
    public struct Account: Decodable, Sendable { public let email: String; public let devices: [Device] }
    public struct Page: Decodable, Sendable { public let records: [SealedRecord]; public let cursor: Int; public let more: Bool }
    public struct PushRecord: Encodable, Sendable { let id: String; let kind: RecordKind; let baseRev: Int; let updatedAt: Int64; let deleted: Bool; let data: Sealed? }
    public struct Accepted: Decodable, Sendable { public let id: String; public let rev: Int }
    public struct PushResult: Decodable, Sendable { public let accepted: [Accepted]; public let conflicts: [SealedRecord] }
    public struct Blob: Decodable, Sendable { public let id: String; public let size: Int; public let createdAt: Int64 }
    public struct Blobs: Decodable, Sendable { public let blobs: [Blob]; public let now: Int64 }
    public struct Changes: Decodable, Sendable { public let changed: Bool; public let rev: Int }
    private struct ErrorBody: Decodable { let error: String? }
    private struct Empty: Decodable {}

    private static let session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 60
        config.waitsForConnectivity = false
        return URLSession(configuration: config)
    }()

    private func request(_ method: String, _ route: String, body: (any Encodable)? = nil, timeout: TimeInterval = 30, contentType: String = "application/json", raw: Data? = nil) throws -> URLRequest {
        guard let url = URL(string: "\(serverURL)/api/v1\(route)") else { throw SyncError(status: 0, message: "That server address isn’t valid.") }
        var r = URLRequest(url: url, timeoutInterval: timeout)
        r.httpMethod = method
        r.setValue(contentType, forHTTPHeaderField: "content-type")
        if !token.isEmpty { r.setValue("Bearer \(token)", forHTTPHeaderField: "authorization") }
        if let body { r.httpBody = try JSONEncoder().encode(body) }
        if let raw { r.httpBody = raw }
        return r
    }

    private func send(_ request: URLRequest) async throws -> (Data, Int) {
        do {
            let (data, response) = try await Self.session.data(for: request)
            return (data, (response as? HTTPURLResponse)?.statusCode ?? 0)
        } catch let e as URLError {
            if e.code == .cancelled { throw CancellationError() }
            throw unreachable(e)
        }
    }

    private func call<T: Decodable>(_ method: String, _ route: String, body: (any Encodable)? = nil, timeout: TimeInterval = 30) async throws -> T {
        let (data, status) = try await send(request(method, route, body: body, timeout: timeout))
        guard (200..<300).contains(status) else {
            let message = (try? JSONDecoder().decode(ErrorBody.self, from: data))?.error ?? "Sync server error \(status)."
            throw SyncError(status: status, message: message)
        }
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw SyncError(status: status, message: "The sync server sent a reply this app doesn’t understand.")
        }
    }

    private func unreachable(_ e: URLError) -> SyncError {
        let why = switch e.code {
        case .timedOut: "it didn’t answer in time. Check the address and that the server is running."
        case .cannotConnectToHost: "nothing is listening at that address and port. Check the port and that the server is running."
        case .cannotFindHost, .dnsLookupFailed: "that name couldn’t be found. Check the spelling, or use the server’s IP address."
        case .notConnectedToInternet: "this device is offline."
        case .secureConnectionFailed where serverURL.hasPrefix("https:"):
            "it doesn’t use https. If it’s on a private network, use http:// instead."
        case .serverCertificateUntrusted, .serverCertificateHasBadDate, .serverCertificateHasUnknownRoot, .secureConnectionFailed:
            "its https certificate isn’t trusted. Use a certificate from a public authority (Caddy or Let’s Encrypt can do this)."
        case .appTransportSecurityRequiresSecureConnection: "this app only allows http for private network addresses."
        default: e.localizedDescription
        }
        return SyncError(status: 0, message: "Can’t reach the sync server at \(serverURL): \(why)")
    }

    private static func base64URL(_ b: [UInt8]) -> String {
        Data(b).base64EncodedString().replacing("+", with: "-").replacing("/", with: "_").replacing("=", with: "")
    }

    public func health(timeout: TimeInterval = 30) async throws -> Health { try await call("GET", "/health", timeout: timeout) }

    /// A client for the first of `addresses` (main, then backup) whose server answers. With one address there's
    /// nothing to choose, so it's returned without asking. The main address gets a short wait, since the backup
    /// is there for when it's out of reach; a server error behind a proxy (5xx) counts as out of reach too.
    public static func reachable(_ addresses: [String], token: String = "", probeTimeout: TimeInterval = 5) async throws -> SyncClient {
        guard addresses.count > 1 else { return SyncClient(serverURL: addresses.first ?? "", token: token) }
        var firstError: SyncError?
        for address in addresses {
            let client = SyncClient(serverURL: address, token: token)
            do {
                _ = try await client.health(timeout: probeTimeout)
                return client
            } catch let error as SyncError where error.status == 0 || error.status >= 500 {
                firstError = firstError ?? error
            }
        }
        throw SyncError(status: 0, message: "\(firstError?.message ?? "Can’t reach the sync server.") Its backup address didn’t answer either.")
    }

    public func prelogin(email: String) async throws -> KdfParams {
        struct R: Decodable { let kdf: KdfParams }
        let r: R = try await call("POST", "/prelogin", body: ["email": email])
        return r.kdf
    }

    public mutating func signup(email: String, authKey: [UInt8], keyset: Keyset, device: String) async throws {
        struct Body: Encodable { let email: String; let authKey: String; let kdf: KdfParams; let wrappedKey: Sealed; let accountId: String; let device: String }
        struct R: Decodable { let token: String }
        let r: R = try await call("POST", "/accounts", body: Body(email: email, authKey: Self.base64URL(authKey), kdf: keyset.kdf,
                                                                 wrappedKey: keyset.wrappedKey, accountId: keyset.accountId, device: device))
        token = r.token
    }

    public mutating func login(email: String, authKey: [UInt8], device: String) async throws -> LoginResponse {
        let r: LoginResponse = try await call("POST", "/login", body: ["email": email, "authKey": Self.base64URL(authKey), "device": device])
        token = r.token
        return r
    }

    public func logout() async throws { let _: Empty = try await call("POST", "/logout") }
    public func account() async throws -> Account { try await call("GET", "/account") }

    public func updateKeys(authKey: [UInt8], keyset: Keyset) async throws {
        struct Body: Encodable { let authKey: String; let kdf: KdfParams; let wrappedKey: Sealed }
        let _: Empty = try await call("PUT", "/account/keys", body: Body(authKey: Self.base64URL(authKey), kdf: keyset.kdf, wrappedKey: keyset.wrappedKey))
    }

    /// Waits until another device changes something, or `wait` seconds pass.
    public func waitForChanges(since: Int, wait: Int = 25) async throws -> Changes {
        try await call("GET", "/changes?since=\(since)&wait=\(wait)", timeout: TimeInterval(wait + 15))
    }

    public func pull(since: Int) async throws -> Page { try await call("GET", "/records?since=\(since)") }

    public func push(_ records: [SealedRecord]) async throws -> PushResult {
        let body = ["records": records.map { PushRecord(id: $0.id, kind: $0.kind, baseRev: $0.rev, updatedAt: $0.updatedAt, deleted: $0.isDeleted, data: $0.data) }]
        return try await call("POST", "/records", body: body)
    }

    public func listBlobs() async throws -> Blobs { try await call("GET", "/blobs") }

    public func deleteBlob(_ id: String) async throws {
        let _: Empty = try await call("DELETE", "/blobs/\(id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id)")
    }

    public func putBlob(_ id: String, _ bytes: Data) async throws {
        let (data, status) = try await send(request("PUT", "/blobs/\(id)", timeout: 600, contentType: "application/octet-stream", raw: bytes))
        guard (200..<300).contains(status) else {
            throw SyncError(status: status, message: (try? JSONDecoder().decode(ErrorBody.self, from: data))?.error ?? "Sync server error \(status).")
        }
    }

    /// The sealed file, or nil if the server doesn't have it yet.
    public func getBlob(_ id: String) async throws -> Data? {
        let (data, status) = try await send(request("GET", "/blobs/\(id)", timeout: 600, contentType: "application/octet-stream"))
        if status == 404 { return nil }
        guard (200..<300).contains(status) else {
            throw SyncError(status: status, message: (try? JSONDecoder().decode(ErrorBody.self, from: data))?.error ?? "Sync server error \(status).")
        }
        return data
    }
}
