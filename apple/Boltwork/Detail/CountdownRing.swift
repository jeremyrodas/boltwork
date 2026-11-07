import SwiftUI

/// A small ring that empties as a one-time code's period runs out, with the seconds left inside.
struct CountdownRing: View {
    let remaining: Int
    let period: Int

    var body: some View {
        ZStack {
            Circle().stroke(Theme.line, lineWidth: 2.5)
            Circle()
                .trim(from: 0, to: Double(remaining) / Double(max(period, 1)))
                .stroke(remaining <= 5 ? Theme.bad : Theme.accent, style: StrokeStyle(lineWidth: 2.5, lineCap: .round))
                .rotationEffect(.degrees(-90))
                .animation(.linear(duration: 1), value: remaining)
            Text(remaining, format: .number)
                .font(.system(size: 9, weight: .semibold).monospacedDigit())
                .foregroundStyle(.secondary)
        }
        .frame(width: 22, height: 22)
        .accessibilityLabel("\(remaining) seconds left")
    }
}
