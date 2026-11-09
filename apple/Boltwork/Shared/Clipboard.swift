import SwiftUI
import UniformTypeIdentifiers

/// Copies text, keeping secrets off other devices and clearing them after a while.
enum Clipboard {
    static func copy(_ text: String, secret: Bool) {
        let seconds = UserDefaults.standard.object(forKey: AppSettings.clipboardClearSeconds) as? Int ?? AppSettings.defaultClipboardClearSeconds
        #if os(iOS)
        var options: [UIPasteboard.OptionsKey: Any] = [.localOnly: secret]
        if secret && seconds > 0 { options[.expirationDate] = Date.now.addingTimeInterval(TimeInterval(seconds)) }
        UIPasteboard.general.setItems([[UTType.plainText.identifier: text]], options: options)
        #else
        let board = NSPasteboard.general
        board.clearContents()
        board.setString(text, forType: .string)
        if secret {
            // Tells clipboard managers not to keep it (nspasteboard.org).
            board.setString("", forType: NSPasteboard.PasteboardType("org.nspasteboard.ConcealedType"))
            guard seconds > 0 else { return }
            let change = board.changeCount
            Task {
                try? await Task.sleep(for: .seconds(seconds))
                if board.changeCount == change { board.clearContents() }
            }
        }
        #endif
    }
}
