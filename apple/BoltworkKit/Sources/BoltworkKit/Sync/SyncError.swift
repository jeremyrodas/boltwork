import Foundation

public struct SyncError: LocalizedError, Sendable {
    /// HTTP status, or 0 if the server couldn't be reached.
    public let status: Int
    public let message: String
    public var errorDescription: String? { message }
    /// The server rejected this device's session; the user must sign in again.
    public var isSignedOut: Bool { status == 401 }
}
