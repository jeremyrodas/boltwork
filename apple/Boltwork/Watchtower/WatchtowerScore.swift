import BoltworkKit
import SwiftUI

struct WatchtowerScore: View {
    let report: WatchtowerReport

    private var color: Color {
        switch report.score {
        case 901...: .green
        case 601...: .yellow
        case 401...: .orange
        default: .red
        }
    }

    var body: some View {
        HStack(spacing: 16) {
            Gauge(value: Double(report.score), in: 0...1000) {
                Text("Security score")
            } currentValueLabel: {
                Text(report.score, format: .number)
            }
            .gaugeStyle(.accessoryCircularCapacity)
            .tint(color)
            VStack(alignment: .leading) {
                Text(report.scoreLabel).font(.title2.bold())
                Text("^[\(report.issues.count) issue](inflect: true) to review")
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 6)
        .accessibilityElement(children: .combine)
    }
}
