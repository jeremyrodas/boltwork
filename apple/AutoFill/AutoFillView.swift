import AuthenticationServices
import SwiftUI

struct AutoFillView: View {
    let session: AutoFillSession

    var body: some View {
        NavigationStack {
            #if os(macOS)
            // The Mac's AutoFill sheet shows no toolbar, so the way out is a button of its own (Esc works too).
            VStack(spacing: 0) {
                content.frame(maxWidth: .infinity, maxHeight: .infinity)
                Divider()
                HStack {
                    Spacer()
                    Button("Cancel") { session.cancel() }.keyboardShortcut(.cancelAction)
                }
                .padding(12)
            }
            #else
            content
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel") { session.cancel() }
                    }
                }
            #endif
        }
        .tint(Theme.accent)
        .task { await session.unlock() }
    }

    @ViewBuilder private var content: some View {
        if session.store == nil {
            AutoFillUnlockView(session: session)
        } else {
            switch session.request {
            case .list(let services, let passkey):
                CredentialPicker(session: session, services: services, passkeyParameters: passkey)
            case .codes(let services):
                CodePicker(session: session, services: services)
            case .register(let request):
                PasskeyRegistrationView(session: session, request: request)
            case .configure:
                ContentUnavailableView {
                    Label("AutoFill Is On", systemImage: "checkmark.shield")
                } description: {
                    Text("Boltwork suggests your logins, passkeys and verification codes when you sign in to apps and websites.")
                } actions: {
                    Button("Done") { session.done(.configured) }.buttonStyle(.borderedProminent)
                }
            case .provide:
                ProgressView()
            }
        }
    }
}

private struct AutoFillUnlockView: View {
    let session: AutoFillSession

    var body: some View {
        if let problem = session.problem {
            ContentUnavailableView {
                Label("Boltwork Is Locked", systemImage: "lock")
            } description: {
                Text(problem)
            } actions: {
                Button("Try Again") { Task { await session.unlock() } }
            }
        } else {
            ProgressView("Unlocking…")
        }
    }
}
