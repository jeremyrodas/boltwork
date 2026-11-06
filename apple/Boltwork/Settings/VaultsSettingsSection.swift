import BoltworkKit
import SwiftUI

/// The vaults inside the account: add, rename, delete.
struct VaultsSettingsSection: View {
    @Environment(AppModel.self) private var model
    @State private var addingVault = false
    @State private var newName = ""
    @State private var renaming: Vault?
    @State private var deleting: Vault?

    var body: some View {
        if model.phase == .unlocked {
            Section("Vaults") {
                ForEach(model.vaults) { vault in
                    LabeledContent {
                        Text("^[\(model.items.count { $0.vaultId == vault.id && $0.state != .deleted }) item](inflect: true)")
                    } label: {
                        Label(vault.name, systemImage: "lock.square.stack")
                    }
                    .contextMenu {
                        Button("Rename…", systemImage: "pencil") { renaming = vault; newName = vault.name }
                        if model.vaults.count > 1 {
                            Button("Delete…", systemImage: "trash", role: .destructive) { deleting = vault }
                        }
                    }
                    .swipeActions {
                        if model.vaults.count > 1 {
                            Button("Delete", systemImage: "trash", role: .destructive) { deleting = vault }
                        }
                        Button("Rename", systemImage: "pencil") { renaming = vault; newName = vault.name }
                    }
                }
                Button("New Vault…", systemImage: "plus") { newName = ""; addingVault = true }
            }
            .alert("New Vault", isPresented: $addingVault) {
                TextField("Name", text: $newName)
                Button("Create") { if !newName.isEmpty { model.newVault(named: newName) } }
                Button("Cancel", role: .cancel) {}
            }
            .alert("Rename Vault", item: $renaming) { vault in
                TextField("Name", text: $newName)
                Button("Rename") {
                    var v = vault
                    v.name = newName
                    if !newName.isEmpty { model.saveVault(v) }
                }
                Button("Cancel", role: .cancel) {}
            }
            .confirmationDialog("Delete this vault?", item: $deleting) { vault in
                if let other = model.vaults.first(where: { $0.id != vault.id }) {
                    Button("Move Items to “\(other.name)” and Delete") { model.deleteVault(vault, movingItemsTo: other.id) }
                }
                Button("Delete Vault and Its Items", role: .destructive) { model.deleteVault(vault, movingItemsTo: nil) }
            } message: { vault in
                Text("“\(vault.name)” will be removed from all your devices.")
            }
        }
    }
}
