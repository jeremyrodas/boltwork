import SwiftUI

/// Preferences. On the Mac this is the Settings window, with tabs; on iPhone and iPad it's one sheet.
struct SettingsView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @AppStorage(AppSettings.appearance) private var appearance = Appearance.system

    var body: some View {
        #if os(macOS)
        TabView {
            Tab("Appearance", systemImage: "circle.lefthalf.filled") {
                Form { AppearanceSettingsSection() }.formStyle(.grouped)
            }
            Tab("Security", systemImage: "lock.shield") {
                Form { SecuritySettingsSection() }.formStyle(.grouped)
            }
            Tab("Sync", systemImage: "arrow.triangle.2.circlepath") {
                Form { UnlockedOnly { SyncSettingsSection() } }.formStyle(.grouped)
            }
            Tab("Browser", systemImage: "globe") {
                Form { BrowserSettingsSection() }.formStyle(.grouped)
            }
            Tab("SSH", systemImage: "terminal") {
                Form { SSHAgentSettingsSection() }.formStyle(.grouped)
            }
            Tab("Vaults", systemImage: "lock.square.stack") {
                Form { UnlockedOnly { VaultsSettingsSection() } }.formStyle(.grouped)
            }
            Tab("Account", systemImage: "person.crop.circle") {
                NavigationStack {
                    Form { UnlockedOnly { AccountSettingsSection(); AutoFillSettingsSection() } }.formStyle(.grouped)
                }
            }
        }
        .preferredColorScheme(appearance.colorScheme)
        #else
        NavigationStack {
            Form {
                AccountSettingsSection()
                AutoFillSettingsSection()
                AppearanceSettingsSection()
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
        // Sheets keep the look they opened with unless told; this one changes it.
        .preferredColorScheme(appearance.colorScheme)
        #endif
    }
}
