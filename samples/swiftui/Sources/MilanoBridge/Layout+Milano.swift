import MilanoSDK
import SwiftUI

/// The layout and media primitives behind the profile and catalog screens:
/// generic containers and an image, everything meaningful still declared in
/// the documents.

final class RowRenderer: MilanoRenderer {
    func render(_ node: MilanoNode) -> AnyView {
        let row = SampleRowNode(node)
        // Top alignment is what keeps a strip of tiles readable: labels
        // wrap to different heights, and centring them would leave the
        // icons on different lines.
        let alignment: VerticalAlignment
        switch row.alignment ?? .center {
        case .top: alignment = .top
        case .bottom: alignment = .bottom
        case .center: alignment = .center
        }
        let inset = CGFloat(row.horizontalPadding ?? 0)
        let content = HStack(alignment: alignment, spacing: CGFloat(row.spacing ?? 8)) {
            ForEach(node.children) { $0 }
        }
        .padding(.horizontal, inset)
        // A scrolling row is how a strip of tiles stays on screen whatever
        // its content: without it the row is as wide as its children want,
        // and anything past the edge is unreachable. The padding sits
        // inside the scroll, so it reads as the strip's leading and
        // trailing inset rather than as a gap that scrolls away.
        guard row.scrolls == true else { return AnyView(content) }
        return AnyView(
            ScrollView(.horizontal, showsIndicators: false) { content }
        )
    }
}

final class CardRenderer: MilanoRenderer {
    func render(_ node: MilanoNode) -> AnyView {
        let card = SampleCardNode(node)
        // `plain` is a card that is tappable without looking like a
        // surface: no fill, no width of its own, children centred. It is
        // what a strip of quick action tiles is made of, where the only
        // filled shape is the circle behind each icon.
        let plain = card.style == .plain
        var view = AnyView(
            VStack(alignment: plain ? .center : .leading, spacing: 8) {
                ForEach(node.children) { $0 }
            }
            .padding(CGFloat(card.padding ?? 12))
            .frame(maxWidth: plain ? nil : .infinity, alignment: plain ? .center : .leading)
            .background(plain ? Color.clear : Color.secondaryBackground)
            .clipShape(RoundedRectangle(cornerRadius: plain ? 0 : CGFloat(card.cornerRadius ?? 12)))
            .contentShape(Rectangle())
            .onTapGesture { card.emitTap() }
            // Cards are tappable by design: one activatable element.
            .accessibilityAddTraits(.isButton)
        )
        if let label = card.accessibilityLabel {
            view = AnyView(
                view.accessibilityElement(children: .ignore).accessibilityLabel(label))
        }
        if let hint = card.accessibilityHint {
            view = AnyView(view.accessibilityHint(hint))
        }
        return view
    }
}

final class ImageRenderer: MilanoRenderer {
    func render(_ node: MilanoNode) -> AnyView {
        let image = SampleImageNode(node)
        let width = image.width.map(CGFloat.init)
        let height = image.height.map(CGFloat.init)
        return AnyView(
            AsyncImage(url: URL(string: image.url)) { phase in
                if case .success(let loaded) = phase {
                    loaded.resizable().scaledToFill()
                } else {
                    Color.secondaryBackground
                }
            }
            .frame(width: width, height: height)
            .clipShape(RoundedRectangle(cornerRadius: CGFloat(image.cornerRadius ?? 0)))
            .accessibilityLabel(image.contentDescription ?? "")
            // Decorative images vanish from the accessibility tree.
            .accessibilityHidden(image.decorative ?? false)
        )
    }
}
