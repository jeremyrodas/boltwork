import SwiftUI

/// What Home shows before there's anything in the vault.
struct HomeWelcomeCard: View {
    @Binding var sheet: BrowserSheet?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Image(.brandMark)
                .resizable()
                .frame(width: 44, height: 44)
            Text("Set up your vault")
                .font(.title3.weight(.semibold))
            Text("Add your first login, card or note. Favorites, recent items and one-time codes will show up here.")
                .foregroundStyle(.secondary)
            Button("Add a Login", systemImage: "plus") { sheet = .newItem(.login) }
                .buttonStyle(.borderedProminent)
                .padding(.top, 4)
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.graphite.gradient, in: .rect(cornerRadius: Theme.cardCornerRadius))
        .foregroundStyle(.white)
        .environment(\.colorScheme, .dark)
    }
}
