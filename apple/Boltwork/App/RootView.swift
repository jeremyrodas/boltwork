import SwiftUI

/// Chooses the screen for the vault's state, and hides content while the app isn't in front.
struct RootView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        @Bindable var model = model
        ZStack {
            switch model.phase {
            case .welcome:
                WelcomeView()
            case .locked:
                LockView()
            case .unlocked:
                VaultBrowser()
            }
            #if os(iOS)
            if scenePhase != .active {
                PrivacyCover()
            }
            #endif
        }
        .animation(.default, value: model.phase)
        .sheet(item: $model.newSecretKey) { key in
            SecretKeySheet(secretKey: key.value)
                .interactiveDismissDisabled()
        }
        .alert("Something went wrong", item: $model.alertMessage) { _ in
        } message: { message in
            Text(message)
        }
    }
}
