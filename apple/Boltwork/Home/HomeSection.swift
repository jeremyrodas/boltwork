import BoltworkKit
import SwiftUI

/// A card of items that folds away. A list on iPhone, a grid on iPad.
struct HomeSection: View {
    let title: String
    let symbol: String
    let tint: Color
    let items: [Item]
    @Environment(\.horizontalSizeClass) private var sizeClass
    @SceneStorage private var expanded: Bool

    init(title: String, symbol: String, tint: Color, items: [Item]) {
        self.title = title
        self.symbol = symbol
        self.tint = tint
        self.items = items
        _expanded = SceneStorage(wrappedValue: true, "home.\(title)")
    }

    var body: some View {
        if !items.isEmpty {
            VStack(alignment: .leading, spacing: 0) {
                Button {
                    withAnimation(.snappy) { expanded.toggle() }
                } label: {
                    HStack(spacing: 12) {
                        Image(systemName: symbol)
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(.white)
                            .frame(width: 28, height: 28)
                            .background(tint.gradient, in: .circle)
                        Text(title).font(.headline)
                        Spacer()
                        Image(systemName: "chevron.down")
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(Theme.accent)
                            .rotationEffect(expanded ? .zero : .degrees(-90))
                    }
                    .padding(14)
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityValue(expanded ? "Expanded" : "Collapsed")
                if expanded {
                    Divider().overlay(Theme.line)
                    if sizeClass == .regular {
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 230), spacing: 8, alignment: .leading)], alignment: .leading, spacing: 4) {
                            ForEach(items) { item in
                                NavigationLink(value: ItemRoute(id: item.id)) {
                                    HomeItemTile(item: item)
                                        .padding(8)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        .padding(8)
                    } else {
                        ForEach(items.enumerated(), id: \.element.id) { index, item in
                            if index > 0 { Divider().overlay(Theme.line).padding(.leading, 64) }
                            NavigationLink(value: ItemRoute(id: item.id)) {
                                HomeItemTile(item: item, showsChevron: true)
                                    .padding(.horizontal, 14)
                                    .padding(.vertical, 8)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
            .card()
        }
    }
}
