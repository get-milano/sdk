import MilanoSDK
import SwiftUI

extension PressableIconModel {
    init(_ button: SampleIconButtonNode) {
        let icon: Icon
        switch button.icon {
        case .eye: icon = .eye
        case .eyeOff: icon = .eyeOff
        }
        self.init(
            icon: icon,
            accessibilityLabel: button.accessibilityLabel,
            accessibilityHint: button.accessibilityHint,
            // The document models the press itself, so both edges are
            // declared events; reporting an interaction here as well would
            // double-count.
            onPressStart: { button.emitPressStart() },
            onPressEnd: { button.emitPressEnd() }
        )
    }
}

final class IconButtonRenderer: MilanoRenderer {
    func render(_ node: MilanoNode) -> AnyView {
        AnyView(PressableIcon(model: PressableIconModel(SampleIconButtonNode(node))))
    }
}
