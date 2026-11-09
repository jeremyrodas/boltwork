import BoltworkKit
import SwiftUI

/// Quick unlock, the Secret Key and Emergency Kit, and changing the account password.
struct AccountSettingsSection: View {
    @Environment(AppModel.self) private var model
    @State private var quickUnlock = false
    @State private var changingPassword = false

    var body: some View {
        if model.phase == .unlocked {
            Section {
                if let name = QuickUnlockInfo.name {
                    Toggle("Unlock with \(name)", systemImage: QuickUnlockInfo.symbol, isOn: $quickUnlock)
                        .onChange(of: quickUnlock) { _, on in
                            if on != model.isQuickUnlockEnabled { model.setQuickUnlock(on) }
                            quickUnlock = model.isQuickUnlockEnabled
                        }
                } else if let name = QuickUnlock.hardwareName {
                    Toggle("Unlock with \(name)", systemImage: QuickUnlockInfo.symbol, isOn: .constant(false))
                        .disabled(true)
                }
                NavigationLink {
                    AccountRecoveryView()
                } label: {
                    Label("Secret Key and Emergency Kit", systemImage: "key.viewfinder")
                }
                Button("Change Account Password…", systemImage: "lock.rotation") { changingPassword = true }
            } header: {
                Text("Account")
            } footer: {
                if QuickUnlockInfo.name == nil, let name = QuickUnlock.hardwareName {
                    Text("Set up \(name) on this device to unlock Boltwork with it.")
                }
            }
            .onAppear { quickUnlock = model.isQuickUnlockEnabled }
            .sheet(isPresented: $changingPassword) { ChangePasswordSheet() }
        }
    }
}
