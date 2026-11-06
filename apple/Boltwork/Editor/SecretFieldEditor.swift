import BoltworkKit
import SwiftUI

/// A password or other secret: hidden by default, with a generator and a strength meter for passwords.
struct SecretFieldEditor: View {
    @Binding var field: Field
    @State private var revealed = false
    @State private var generating = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                // No SecureField: iOS treats any secure field as a sign-in form and asks to save the item into its own
                // Passwords app. A saved secret stays masked until revealed; a new one is typed in the open.
                if revealed {
                    TextField(field.label, text: $field.value)
                        .font(Theme.monospacedSecret)
                        .plainTextEntry()
                        .notASystemPassword()
                } else {
                    Text("••••••••••")
                        .accessibilityLabel("Hidden")
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                Button(revealed ? "Hide" : "Reveal", systemImage: revealed ? "eye.slash" : "eye") { revealed.toggle() }
                    .labelStyle(.iconOnly)
                    .buttonStyle(.borderless)
                    .frame(minWidth: 44, minHeight: 44)
                if field.purpose == .password {
                    Button("Generate Password", systemImage: "wand.and.stars") { generating = true }
                        .labelStyle(.iconOnly)
                        .buttonStyle(.borderless)
                        .frame(minWidth: 44, minHeight: 44)
                }
            }
            if field.purpose == .password && !field.value.isEmpty {
                StrengthMeter(strength: PasswordStrength(field.value))
            }
        }
        .onAppear { if field.value.isEmpty { revealed = true } }
        .sheet(isPresented: $generating) {
            NavigationStack {
                GeneratorView(target: $field.value)
            }
        }
    }
}
