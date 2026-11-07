import BoltworkKit
import SwiftUI

/// A big number for one kind of problem, such as reused passwords.
struct IssueCountCard: View {
    let check: WatchtowerCheck
    let count: Int

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(count, format: .number)
                    .font(.system(size: 34, weight: .bold, design: .rounded))
                Spacer()
                Image(systemName: check.symbol)
                    .font(.title2)
                    .foregroundStyle(Theme.bad.opacity(0.7))
            }
            Text(check.title)
                .font(.subheadline.weight(.medium))
                .multilineTextAlignment(.leading)
            Spacer(minLength: 0)
        }
        .padding(16)
        .frame(maxWidth: .infinity, minHeight: 110, alignment: .leading)
        .card()
        .accessibilityElement(children: .combine)
    }
}
