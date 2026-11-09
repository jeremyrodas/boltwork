import BoltworkKit
import SwiftUI

/// How strong the vault's passwords are, as one bar split from weakest to strongest.
struct StrengthBreakdown: View {
    let passwords: [String]

    private static let bands: [(label: String, levels: ClosedRange<Int>, color: Color)] = [
        ("Terrible", 0...2, Theme.bad), ("Weak", 3...3, .orange), ("Fair", 4...4, Theme.warn),
        ("Good", 5...5, .mint), ("Excellent", 6...7, Theme.good),
    ]

    var body: some View {
        let levels = passwords.map { PasswordStrength($0).level }
        let counts = Self.bands.map { band in levels.count { band.levels.contains($0) } }
        VStack(alignment: .leading, spacing: 10) {
            Text("Overall Password Strength").font(.headline)
            if levels.isEmpty {
                Text("No passwords yet.").foregroundStyle(.secondary)
            } else {
                GeometryReader { geo in
                    HStack(spacing: 2) {
                        ForEach(Array(Self.bands.enumerated()), id: \.offset) { i, band in
                            if counts[i] > 0 {
                                band.color
                                    .frame(width: max(6, (geo.size.width - 8) * Double(counts[i]) / Double(levels.count)))
                            }
                        }
                    }
                    .clipShape(.capsule)
                }
                .frame(height: 14)
                HStack(spacing: 12) {
                    ForEach(Array(Self.bands.enumerated()), id: \.offset) { i, band in
                        if counts[i] > 0 {
                            Label {
                                Text("\(counts[i]) \(band.label)")
                            } icon: {
                                Circle().fill(band.color).frame(width: 8, height: 8)
                            }
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
        .accessibilityElement(children: .combine)
    }
}
