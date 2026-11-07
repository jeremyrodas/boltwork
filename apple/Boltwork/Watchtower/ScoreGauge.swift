import SwiftUI

/// The security score on an open arc, colored by how good it is.
struct ScoreGauge: View {
    let score: Int
    let label: String

    static func color(_ score: Int) -> Color {
        switch score {
        case 801...: Theme.good
        case 601...: Theme.brass
        case 401...: Theme.warn
        default: Theme.bad
        }
    }

    var body: some View {
        let sweep = 0.75
        let color = Self.color(score)
        ZStack {
            Circle()
                .trim(from: 0, to: sweep)
                .stroke(Theme.line, style: StrokeStyle(lineWidth: 18, lineCap: .round))
                .rotationEffect(.degrees(135))
            Circle()
                .trim(from: 0, to: sweep * Double(score) / 1000)
                .stroke(color.gradient, style: StrokeStyle(lineWidth: 18, lineCap: .round))
                .rotationEffect(.degrees(135))
            VStack(spacing: 2) {
                Text(score, format: .number)
                    .font(.system(size: 52, weight: .bold, design: .rounded).monospacedDigit())
                    .contentTransition(.numericText())
                Text(label.uppercased())
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.secondary)
            }
        }
        .frame(width: 220, height: 220)
        .padding(.bottom, -30)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Security score \(score) out of 1000, \(label)")
    }
}
