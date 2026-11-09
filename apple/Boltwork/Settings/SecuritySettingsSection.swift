import SwiftUI

struct SecuritySettingsSection: View {
    @AppStorage(AppSettings.autolockMinutes) private var autolockMinutes = AppSettings.defaultAutolockMinutes
    @AppStorage(AppSettings.clipboardClearSeconds) private var clipboardSeconds = AppSettings.defaultClipboardClearSeconds
    @AppStorage(AppSettings.concealPasswords) private var concealPasswords = true

    var body: some View {
        Section {
            Picker("Lock Boltwork", selection: $autolockMinutes) {
                Text("Immediately").tag(0)
                Text("After 1 minute").tag(1)
                Text("After 5 minutes").tag(5)
                Text("After 15 minutes").tag(15)
                Text("After 1 hour").tag(60)
                Text("Never").tag(-1)
            }
            Picker("Clear copied secrets", selection: $clipboardSeconds) {
                Text("After 30 seconds").tag(30)
                Text("After 90 seconds").tag(90)
                Text("After 5 minutes").tag(300)
                Text("Never").tag(0)
            }
            Toggle("Hide passwords until revealed", isOn: $concealPasswords)
        } header: {
            Text("Security")
        } footer: {
            #if os(macOS)
            Text("Boltwork also locks when your Mac sleeps or its screen locks, and after this long without keyboard or mouse use.")
            #else
            Text("Boltwork locks when it has been in the background this long.")
            #endif
        }
    }
}
