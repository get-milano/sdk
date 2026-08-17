import MilanoSDK
import SwiftUI

extension ButtonModel {
    init(_ button: SampleButtonNode) {
        self.init(
            label: button.label,
            isEnabled: button.enabled,
            onTap: { button.emitTap() })
    }
}

final class ButtonRenderer: MilanoRenderer {
    func render(_ node: MilanoNode) -> AnyView {
        let button = SampleButtonNode(node)
        guard button.visible ?? true else { return AnyView(EmptyView()) }
        return AnyView(PrimaryButton(model: ButtonModel(button)))
    }
}
