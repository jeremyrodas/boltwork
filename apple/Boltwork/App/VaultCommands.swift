import SwiftUI

/// Menu bar commands (and keyboard shortcuts on iPad and Mac).
struct VaultCommands: Commands {
    let model: AppModel

    var body: some Commands {
        CommandGroup(after: .appSettings) {
            Button("Lock Boltwork", systemImage: "lock", action: model.lock)
                .keyboardShortcut("l", modifiers: [.command, .shift])
                .disabled(model.phase != .unlocked)
        }
    }
}
