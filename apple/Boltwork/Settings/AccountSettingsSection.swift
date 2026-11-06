import BoltworkKit
import SwiftUI

/// Quick unlock, the Secret Key and Emergency Kit, and changing the account password.
struct AccountSettingsSection: View {
    @Environment(AppModel.self) private var model
    @State private var quickUnlock = false
    @State private var showingSecretKey = false
    @State private var changingPassword = false

    var body: some View {
        if model.phase == .unlocked {
            Section("Account") {
                if let name = QuickUnlockInfo.name {
                    Toggle("Unlock with \(name)", isOn: $quickUnlock)
                        .onChange(of: quickUnlock) { _, on in
                            if on != model.isQuickUnlockEnabled { model.setQuickUnlock(on) }
                        }
                }
                Button("Show Secret Key and Emergency Kit…", systemImage: "key.viewfinder") { showingSecretKey = true }
                Button("Change Account Password…", systemImage: "lock.rotation") { changingPassword = true }
            }
            .onAppear { quickUnlock = model.isQuickUnlockEnabled }
            .sheet(isPresented: $showingSecretKey) { RevealSecretKeySheet() }
            .sheet(isPresented: $changingPassword) { ChangePasswordSheet() }
        }
    }
}
