import BoltworkKit
import SwiftUI

/// The setup key or otpauth:// link for one-time codes, checked as it's typed.
struct TOTPFieldEditor: View {
    @Binding var value: String

    private var problem: String? {
        guard !value.isEmpty else { return nil }
        do {
            _ = try TOTP(value)
            return nil
        } catch {
            return error.localizedDescription
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            TextField("Setup key", text: $value, prompt: Text("Setup key or otpauth:// link"))
                .font(Theme.monospacedSecret)
                .plainTextEntry()
            if let problem {
                Label(problem, systemImage: "exclamationmark.triangle")
                    .font(.footnote)
                    .foregroundStyle(.orange)
            }
        }
    }
}
