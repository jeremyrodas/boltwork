import SwiftUI

/// A line under the sidebar saying whether the vault is in sync.
struct SyncStatusFooter: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        if model.sync.status != .off {
            HStack(spacing: 6) {
                switch model.sync.status {
                case .syncing:
                    ProgressView().controlSize(.mini)
                    Text("Syncing…")
                case .failed(let message):
                    Image(systemName: "exclamationmark.icloud").foregroundStyle(.orange)
                    Text("Sync failed").help(message)
                case .signedOut:
                    Image(systemName: "person.crop.circle.badge.exclamationmark").foregroundStyle(.orange)
                    Text("Signed out of sync")
                case .idle, .off:
                    Image(systemName: "checkmark.icloud").foregroundStyle(.secondary)
                    if let last = model.sync.lastSyncAt {
                        Text("Synced \(last, format: .relative(presentation: .named))")
                    } else {
                        Text("Sync is on")
                    }
                }
                Spacer()
            }
            .font(.footnote)
            .foregroundStyle(.secondary)
            .padding(.horizontal)
            .padding(.vertical, 8)
            .accessibilityElement(children: .combine)
        }
    }
}
