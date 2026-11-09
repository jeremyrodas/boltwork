import BoltworkKit
import SwiftUI

/// For SSH Key items: makes a new key, and fills in the public key, fingerprint and type from a pasted private key.
struct SSHKeyActions: View {
    @Binding var fields: [Field]
    @State private var problem: String?

    private var privateKey: String { value("privateKey") }

    var body: some View {
        Group {
            if privateKey.isEmpty {
                Button("Generate New Ed25519 Key", systemImage: "key.badge.plus") { fill(from: SSHKey.generateEd25519()) }
            }
            if let problem {
                Label(problem, systemImage: "exclamationmark.triangle").foregroundStyle(Theme.bad)
            }
        }
        .onChange(of: privateKey) { _, text in
            problem = nil
            guard !text.isEmpty else { return }
            do { fill(from: try SSHKey(openSSH: text)) } catch { problem = error.localizedDescription }
        }
    }

    private func fill(from key: SSHKey) {
        set("publicKey", key.publicKeyLine)
        set("fingerprint", key.fingerprint)
        set("keyType", key.typeName)
        if privateKey.isEmpty { set("privateKey", key.openSSH) }
    }

    private func value(_ id: String) -> String { fields.first { $0.id == id }?.value ?? "" }

    private func set(_ id: String, _ value: String) {
        if let i = fields.firstIndex(where: { $0.id == id }), fields[i].value != value { fields[i].value = value }
    }
}
