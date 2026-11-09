import SwiftUI

/// The printed Emergency Kit: Secret Key, sync details and a blank for the password.
struct EmergencyKitPage: View {
    let secretKey: String
    let server: String?
    let email: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            HStack(spacing: 12) {
                Image(.brandMark).resizable().frame(width: 48, height: 48)
                Text("Boltwork Emergency Kit").font(.largeTitle.bold())
            }
            Text("Keep this page somewhere safe. With it and your account password you can open your vault on a new device.")
            EmergencyKitField(label: "Secret Key", value: secretKey, monospaced: true)
            if let server { EmergencyKitField(label: "Sync server", value: server) }
            if let email { EmergencyKitField(label: "Email", value: email) }
            EmergencyKitField(label: "Account password", value: " ")
            Text("Created \(Date.now.formatted(date: .long, time: .omitted))").font(.footnote).foregroundStyle(.secondary)
        }
        .padding(48)
        .frame(width: 612, height: 792, alignment: .topLeading)
        .background(.white)
        .environment(\.colorScheme, .light)
    }

}
