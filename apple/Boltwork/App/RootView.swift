import SwiftUI

/// Chooses the screen for the vault's state, and hides content while the app isn't in front.
struct RootView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.scenePhase) private var scenePhase
    @AppStorage(AppSettings.appearance) private var appearance = Appearance.system

    var body: some View {
        @Bindable var model = model
        ZStack {
            switch model.phase {
            case .welcome:
                WelcomeView()
            case .locked:
                LockView()
            case .unlocked:
                #if os(iOS)
                AppTabs()
                #else
                VaultBrowser()
                #endif
            }
            #if os(iOS)
            if scenePhase != .active {
                PrivacyCover()
            }
            #endif
        }
        .tint(Theme.accent)
        .preferredColorScheme(appearance.colorScheme)
        .animation(.default, value: model.phase)
        .onOpenURL { model.open($0) }
        .sheet(item: Binding(get: { model.phase == .unlocked ? model.codeSetup : nil }, set: { model.codeSetup = $0 })) { link in
            CodeSetupSheet(link: link)
        }
        .sheet(item: $model.newSecretKey) { key in
            SecretKeySheet(secretKey: key.value)
                .interactiveDismissDisabled()
        }
        // Waits until a new account's Secret Key has been saved.
        .alert(model.quickUnlockOffer?.title ?? "", isPresented: Binding(
            get: { model.phase == .unlocked && model.newSecretKey == nil && model.quickUnlockOffer != nil },
            set: { if !$0, model.quickUnlockOffer != nil { model.declineQuickUnlockOffer() } }
        ), presenting: model.quickUnlockOffer) { offer in
            Button("Turn On \(offer.biometry)") { model.acceptQuickUnlockOffer() }
            Button("Not Now", role: .cancel) { model.declineQuickUnlockOffer() }
        } message: { offer in
            Text(offer.message)
        }
        .alert("Something went wrong", item: $model.alertMessage) { _ in
        } message: { message in
            Text(message)
        }
    }
}
