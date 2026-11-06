import SwiftUI

/// Shared sizes and styles, so screens stay consistent.
enum Theme {
    /// Brass, the desktop app's default metal.
    static let brass = Color(red: 0.788, green: 0.643, blue: 0.361)
    /// The vault door's graphite.
    static let graphite = Color(red: 0.122, green: 0.141, blue: 0.188)
    static let iconCornerRadius = 8.0
    static let cardCornerRadius = 14.0
    static let readableWidth = 520.0
    static let monospacedSecret = Font.body.monospaced()
}
