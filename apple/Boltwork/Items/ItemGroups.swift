import BoltworkKit
import Foundation

/// Splits a sorted list under headings: letters when sorted by title, months when sorted by date.
enum ItemGroups {
    static func make(_ items: [Item], sort: ItemSort) -> [(title: String, items: [Item])] {
        let key: (Item) -> String
        switch sort {
        case .title:
            key = { item in
                guard let first = item.title.first else { return "#" }
                return first.isLetter ? String(first).uppercased() : "#"
            }
        case .dateModified:
            key = { month($0.updatedDate) }
        case .dateCreated:
            key = { month($0.createdDate) }
        case .frequentlyUsed:
            return items.isEmpty ? [] : [("", items)]
        }
        var groups: [(title: String, items: [Item])] = []
        for item in items {
            let k = key(item)
            if groups.last?.title == k {
                groups[groups.count - 1].items.append(item)
            } else {
                groups.append((k, [item]))
            }
        }
        return groups
    }

    private static func month(_ date: Date) -> String {
        date.formatted(.dateTime.month(.wide).year())
    }
}
