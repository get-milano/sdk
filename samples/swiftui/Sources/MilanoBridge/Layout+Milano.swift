import MilanoSDK
import SwiftUI

/// The layout and media primitives behind the profile and catalog screens:
/// generic containers and an image, everything meaningful still declared in
/// the documents.

final class RowRenderer: MilanoRenderer {
    func render(_ node: MilanoNode) -> AnyView {
        let row = SampleRowNode(node)
        return AnyView(
            HStack(alignment: .center, spacing: CGFloat(row.spacing ?? 8)) {
                ForEach(node.children) { $0 }
            }
        )
    }
}

final class CardRenderer: MilanoRenderer {
    func render(_ node: MilanoNode) -> AnyView {
        let card = SampleCardNode(node)
        var view = AnyView(
            VStack(alignment: .leading, spacing: 8) {
                ForEach(node.children) { $0 }
            }
            .padding(CGFloat(card.padding ?? 12))
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.secondaryBackground)
            .clipShape(RoundedRectangle(cornerRadius: CGFloat(card.cornerRadius ?? 12)))
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
