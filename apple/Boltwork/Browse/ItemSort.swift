/// How the item list is ordered.
enum ItemSort: String, CaseIterable, Identifiable {
    case title, dateModified, dateCreated, frequentlyUsed

    var id: String { rawValue }

    var label: String {
        switch self {
        case .title: "Title"
        case .dateModified: "Date Modified"
        case .dateCreated: "Date Created"
        case .frequentlyUsed: "Most Used"
        }
    }
}
