import BoltworkKit
import Foundation

/// A website row in the editor, with an identity that survives edits.
struct EditableURL: Identifiable {
    let id = UUID()
    var label: String
    var url: String
    var primary: Bool?

    init(_ u: ItemURL) {
        label = u.label
        url = u.url
        primary = u.primary
    }

    init() {
        label = "website"
        url = ""
    }

    var itemURL: ItemURL { ItemURL(label: label, url: url.trimmingCharacters(in: .whitespaces), primary: primary) }
}
