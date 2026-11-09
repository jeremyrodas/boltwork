import SwiftUI

/// First launch: make a new vault, or set this device up from a sync server.
struct WelcomeView: View {
    private enum Route: Hashable { case create, join }
    @State private var path = [Route]()

    var body: some View {
        NavigationStack(path: $path) {
            VStack(spacing: 24) {
                Spacer()
                Image(.brandMark)
                    .resizable()
                    .frame(width: 112, height: 112)
                    .accessibilityHidden(true)
                VStack(spacing: 8) {
                    Text("Welcome to Boltwork")
                        .font(.largeTitle.bold())
                    Text("A password manager that keeps your vault on your own devices, sealed with your password and a Secret Key.")
                        .font(.body)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }
                Spacer()
                VStack(spacing: 12) {
                    NavigationLink(value: Route.create) {
                        Text("Create a New Vault").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    NavigationLink(value: Route.join) {
                        Text("I Already Use Boltwork").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                }
                .controlSize(.large)
                Text("Using Boltwork on another device? Join with your sync server to bring your vault here.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            .padding()
            .frame(maxWidth: Theme.readableWidth)
            .frame(maxWidth: .infinity)
            .navigationDestination(for: Route.self) { route in
                switch route {
                case .create: CreateVaultView()
                case .join: JoinAccountView()
                }
            }
        }
    }
}

#Preview {
    WelcomeView()
        .environment(AppModel(directory: .temporaryDirectory.appending(path: "preview-welcome")))
}
