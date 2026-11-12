#if os(macOS)
import AppKit
import BoltworkKit
import SwiftUI

/// The browser's passkey question, asked without bringing Boltwork's own windows forward.
@MainActor
final class PasskeyPromptPanel: FloatingPanel {
    private var answer: ((BrowserPasskeyDecision) -> Void)?

    static func ask(_ prompt: BrowserPasskeyPrompt) async -> BrowserPasskeyDecision {
        await withCheckedContinuation { done in
            let panel = PasskeyPromptPanel()
            panel.answer = { done.resume(returning: $0) }
            panel.present(PasskeyPromptView(prompt: prompt) { [weak panel] in panel?.finish($0) })
        }
    }

    private func finish(_ decision: BrowserPasskeyDecision) {
        guard let answer else { return }
        self.answer = nil
        close()
        answer(decision)
    }

    override func cancelOperation(_ sender: Any?) { finish(.cancel) }
}

private struct PasskeyPromptView: View {
    let prompt: BrowserPasskeyPrompt
    let answer: (BrowserPasskeyDecision) -> Void
    /// create: which login (the last entry is a new one); get: which passkey.
    @State private var selection: Int

    init(prompt: BrowserPasskeyPrompt, answer: @escaping (BrowserPasskeyDecision) -> Void) {
        self.prompt = prompt
        self.answer = answer
        _selection = State(initialValue: prompt.kind == .create ? prompt.targets.firstIndex { $0.itemId == prompt.suggested } ?? prompt.targets.count : 0)
    }

    private var creating: Bool { prompt.kind == .create }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                Image(nsImage: NSApp.applicationIconImage).resizable().frame(width: 32, height: 32)
                VStack(alignment: .leading, spacing: 2) {
                    Text(creating ? "Save a passkey for \(prompt.site)?" : "Sign in to \(prompt.site) with a passkey?")
                        .font(.headline)
                        .fixedSize(horizontal: false, vertical: true)
                    if creating || prompt.accounts.count == 1 {
                        Text(prompt.accounts.first ?? "").font(.subheadline).foregroundStyle(.secondary)
                    }
                }
            }
            if creating {
                if prompt.targets.isEmpty {
                    Text("It’s saved in a new login.").font(.subheadline).foregroundStyle(.secondary)
                } else {
                    Picker("Save in", selection: $selection) {
                        ForEach(Array(prompt.targets.enumerated()), id: \.offset) { index, target in
                            Text(target.userName.isEmpty ? target.title : "\(target.title) (\(target.userName))").tag(index)
                        }
                        Divider()
                        Text("New Login").tag(prompt.targets.count)
                    }
                }
            } else if prompt.accounts.count > 1 {
                Picker("Account", selection: $selection) {
                    ForEach(Array(prompt.accounts.enumerated()), id: \.offset) { index, account in
                        Text(account).tag(index)
                    }
                }
            }
            HStack {
                Button("Use Another Device") { answer(.fallback) }
                Spacer()
                Button("Cancel", role: .cancel) { answer(.cancel) }
                    .keyboardShortcut(.cancelAction)
                Button(creating ? "Save Passkey" : "Sign In") {
                    let target = creating && selection < prompt.targets.count ? prompt.targets[selection].itemId : nil
                    answer(.ok(index: creating ? 0 : selection, target: target))
                }
                .keyboardShortcut(.defaultAction)
                .buttonStyle(.borderedProminent)
            }
        }
        .padding(16)
        .frame(width: 380)
    }
}
#endif
