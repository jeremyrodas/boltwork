import BoltworkKit
import SwiftUI

/// The editor, generator and settings sheets, and the data-repair notice, for any vault browser.
struct BrowserSheets: ViewModifier {
    @Environment(AppModel.self) private var model
    @Binding var sheet: BrowserSheet?
    @Binding var selection: String?
    let defaultVaultID: String

    func body(content: Content) -> some View {
        @Bindable var model = model
        content
            .sheet(item: $sheet) { sheet in
                switch sheet {
                case .newItem(let category):
                    ItemEditorView(newItemOf: category, defaultVaultID: defaultVaultID, selection: $selection)
                case .edit(let item):
                    ItemEditorView(editing: item, selection: $selection)
                case .generator:
                    NavigationStack { GeneratorView() }
                case .settings:
                    SettingsView()
                }
            }
            .alert("Data Repaired", item: $model.repairNotice) { _ in
            } message: { notice in
                Text(notice)
            }
    }
}

extension View {
    func browserSheets(_ sheet: Binding<BrowserSheet?>, selection: Binding<String?>, defaultVaultID: String) -> some View {
        modifier(BrowserSheets(sheet: sheet, selection: selection, defaultVaultID: defaultVaultID))
    }
}
