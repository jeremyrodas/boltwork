import SwiftUI

@main
struct BoltworkApp: App {
    @State private var model = AppModel()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
        }
        .onChange(of: scenePhase) { _, newPhase in
            model.scenePhaseChanged(to: newPhase)
        }
        .commands {
            VaultCommands(model: model)
        }
        .defaultSize(width: 1100, height: 720)

        #if os(macOS)
        Settings {
            SettingsView()
                .environment(model)
                .frame(width: 520, height: 560)
        }
        #endif
    }
}
