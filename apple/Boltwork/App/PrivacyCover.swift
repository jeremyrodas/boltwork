import SwiftUI

/// Shown over the app in the app switcher, so vault contents never appear in its snapshot.
struct PrivacyCover: View {
    var body: some View {
        ZStack {
            Theme.graphite.ignoresSafeArea()
            Image(.brandMark)
                .resizable()
                .frame(width: 96, height: 96)
                .accessibilityLabel("Boltwork")
        }
    }
}
