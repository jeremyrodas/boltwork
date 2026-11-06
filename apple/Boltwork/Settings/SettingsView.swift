import SwiftUI

/// Preferences. On the Mac this is the Settings window, with tabs; on iPhone and iPad it's one sheet.
struct SettingsView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        #if os(macOS)
        TabView {
            Tab("Security", systemImage: "lock.shield") {
                Form { SecuritySettingsSection() }.formStyle(.grouped)
            }
            Tab("Sync", systemImage: "arrow.triangle.2.circlepath") {
                Form { UnlockedOnly { SyncSettingsSection() } }.formStyle(.grouped)
            }
            Tab("Vaults", systemImage: "lock.square.stack") {
                Form { UnlockedOnly { VaultsSettingsSection() } }.formStyle(.grouped)
            }
            Tab("Account", systemImage: "person.crop.circle") {
                Form { UnlockedOnly { AccountSettingsSection() } }.formStyle(.grouped)
            }
        }
        #else
        NavigationStack {
            Form {
                AccountSettingsSection()
                SecuritySettingsSection()
                SyncSettingsSection()
                VaultsSettingsSection()
                Section {
                    LabeledContent("Version", value: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "")
                }
            }
            .navigationTitle("Settings")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        #endif
    }
}
