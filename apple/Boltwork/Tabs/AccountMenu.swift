import SwiftUI

/// The round Boltwork button at the top left: sync status, generator, settings and lock.
struct AccountMenu: View {
    @Environment(AppModel.self) private var model
    @Binding var sheet: BrowserSheet?

    var body: some View {
        Menu {
            Section {
                Button("Password Generator", systemImage: "wand.and.stars") { sheet = .generator }
                Button("Settings", systemImage: "gearshape") { sheet = .settings }
            }
            Section {
                Button("Lock", systemImage: "lock", action: model.lock)
            }
        } label: {
            Image(.brandMark)
                .resizable()
                .scaledToFit()
                .frame(width: 30, height: 30)
        }
        .accessibilityLabel("Account")
    }
}
