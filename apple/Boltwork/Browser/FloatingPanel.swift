#if os(macOS)
import AppKit
import SwiftUI

/// A small panel that floats over whatever is in front (full-screen apps too) and takes the keyboard
/// without bringing Boltwork's own windows forward.
@MainActor
class FloatingPanel: NSPanel {
    override var canBecomeKey: Bool { true }

    init() {
        super.init(contentRect: .zero, styleMask: [.nonactivatingPanel, .titled, .fullSizeContentView], backing: .buffered, defer: false)
        isReleasedWhenClosed = false
        isFloatingPanel = true
        hidesOnDeactivate = false
        level = .statusBar
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        titleVisibility = .hidden
        titlebarAppearsTransparent = true
        isMovableByWindowBackground = true
        for button in [NSWindow.ButtonType.closeButton, .miniaturizeButton, .zoomButton] { standardWindowButton(button)?.isHidden = true }
    }

    /// Shows `content` in the middle (a little above it) of the screen the pointer is on.
    func present(_ content: some View) {
        let view = NSHostingView(rootView: content)
        setContentSize(view.fittingSize)
        contentView = view
        let screen = NSScreen.screens.first { $0.frame.contains(NSEvent.mouseLocation) } ?? NSScreen.main
        if let area = screen?.visibleFrame {
            setFrameOrigin(NSPoint(x: area.midX - frame.width / 2, y: area.midY - frame.height / 2 + area.height / 8))
        }
        makeKeyAndOrderFront(nil)
        orderFrontRegardless()
    }
}
#endif
