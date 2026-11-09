import SwiftUI

/// Light or dark mode, or follow the system.
struct AppearanceSettingsSection: View {
    @AppStorage(AppSettings.appearance) private var appearance = Appearance.system

    var body: some View {
        Section("Appearance") {
            Picker("Appearance", selection: $appearance) {
                ForEach(Appearance.allCases) { Text($0.label).tag($0) }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
        }
    }
}
