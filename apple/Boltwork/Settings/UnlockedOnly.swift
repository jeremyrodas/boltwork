import SwiftUI

/// Shows settings that need the vault open, or a note to unlock first.
struct UnlockedOnly<Content: View>: View {
    @Environment(AppModel.self) private var model
    @ContentBuilder var content: Content

    var body: some View {
        if model.phase == .unlocked {
            content
        } else {
            ContentUnavailableView("Boltwork Is Locked", systemImage: "lock", description: Text("Unlock Boltwork to change these settings."))
        }
    }
}
