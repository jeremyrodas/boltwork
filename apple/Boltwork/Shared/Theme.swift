import SwiftUI

/// Shared sizes, styles and the desktop app's colors (`src/renderer/styles.css`), so every screen matches.
enum Theme {
    /// Brass, the desktop app's default metal.
    static let brass = Color(red: 0.788, green: 0.643, blue: 0.361)
    /// The vault door's graphite.
    static let graphite = Color(red: 0.122, green: 0.141, blue: 0.188)
    static let iconCornerRadius = 8.0
    static let cardCornerRadius = 14.0
    static let readableWidth = 520.0
    static let monospacedSecret = Font.body.monospaced()

    /// Brass for text and tints: darkened on light backgrounds so it stays readable.
    static let accent = adaptive(0x84621C, 0xD4B06A)
    static let background = adaptive(0xF4F5F8, 0x0F1115)
    static let card = adaptive(0xFFFFFF, 0x151820)
    static let line = adaptive(0xE3E6EE, 0x2A2F3C)
    static let selection = adaptive(0xF2EAD8, 0x2D2A22)
    static let muted = adaptive(0x677087, 0x8B93A7)
    static let good = adaptive(0x15803D, 0x4ADE80)
    static let warn = adaptive(0xA15C07, 0xFBBF24)
    static let bad = adaptive(0xC62828, 0xF87171)
    /// Digits and symbols in generated passwords, so they're easy to read back.
    static let digit = adaptive(0x1D4ED8, 0x60A5FA)
    static let symbol = adaptive(0xDC2626, 0xF87171)

    /// The providers are nonisolated: SwiftUI resolves colors off the main thread.
    private nonisolated static func adaptive(_ light: UInt32, _ dark: UInt32) -> Color {
        @Sendable func parts(_ hex: UInt32) -> (Double, Double, Double) {
            (Double((hex >> 16) & 0xFF) / 255, Double((hex >> 8) & 0xFF) / 255, Double(hex & 0xFF) / 255)
        }
        #if os(iOS)
        return Color(uiColor: UIColor { @Sendable traits in
            let (r, g, b) = parts(traits.userInterfaceStyle == .dark ? dark : light)
            return UIColor(red: r, green: g, blue: b, alpha: 1)
        })
        #else
        return Color(nsColor: NSColor(name: nil) { @Sendable appearance in
            let (r, g, b) = parts(appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? dark : light)
            return NSColor(srgbRed: r, green: g, blue: b, alpha: 1)
        })
        #endif
    }
}
