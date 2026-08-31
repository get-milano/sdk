import SwiftUI

/// A vertical stack. `padding` is what tells a screen's root column from a
/// column nested inside a tile: the root wants the screen's inset, a tile's
/// inner column wants none, and a nested column that kept the screen inset
/// would make every tile 32 points wider than its content.
struct ColumnContainer<Content: View>: View {
    var padding: CGFloat = 16
    var fillsWidth = true
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            content()
        }
        .frame(maxWidth: fillsWidth ? .infinity : nil, alignment: .leading)
        .padding(padding)
    }
}
