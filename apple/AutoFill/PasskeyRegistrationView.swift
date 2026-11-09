import AuthenticationServices
import BoltworkKit
import SwiftUI

/// Saves a new passkey on the site's login for that account, another of the site's logins, or a new login.
struct PasskeyRegistrationView: View {
    let session: AutoFillSession
    let request: ASPasskeyCredentialRequest
    @State private var target: String?
    @State private var choices: (targets: [PasskeyTarget], suggested: String?) = ([], nil)

    var body: some View {
        if let problem = session.registrationProblem(request) {
            ContentUnavailableView("Can’t Save Passkey", systemImage: "person.badge.key", description: Text(problem))
        } else if let identity = request.credentialIdentity as? ASPasskeyCredentialIdentity {
            Form {
                Section {
                    LabeledContent("Website", value: identity.relyingPartyIdentifier)
                    LabeledContent("Account", value: identity.userName)
                }
                if !choices.targets.isEmpty {
                    Section("Save In") {
                        Picker("Save In", selection: $target) {
                            ForEach(choices.targets) { choice in
                                Text(choice.userName.isEmpty ? choice.title : "\(choice.title) (\(choice.userName))").tag(String?.some(choice.itemId))
                            }
                            Text("New Login").tag(String?.none)
                        }
                        .pickerStyle(.inline)
                        .labelsHidden()
                    }
                }
                Section {
                    Button("Save Passkey") { session.register(request, target: target) }
                } footer: {
                    if let problem = session.problem { Text(problem).foregroundStyle(Theme.bad) }
                }
            }
            .formStyle(.grouped)
            .navigationTitle("Save Passkey")
            .onAppear {
                choices = session.targets(for: identity)
                target = choices.suggested
            }
        }
    }
}
