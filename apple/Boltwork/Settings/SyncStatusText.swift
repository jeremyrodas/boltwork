import SwiftUI

struct SyncStatusText: View {
    let status: SyncController.Status
    let lastSync: Date?

    var body: some View {
        switch status {
        case .off: Text("Off")
        case .syncing: Text("Syncing…")
        case .signedOut: Text("Signed out").foregroundStyle(.orange)
        case .failed(let message): Text(message).foregroundStyle(.orange)
        case .idle:
            if let lastSync {
                Text("Synced \(lastSync, format: .relative(presentation: .named))")
            } else {
                Text("Ready")
            }
        }
    }
}
