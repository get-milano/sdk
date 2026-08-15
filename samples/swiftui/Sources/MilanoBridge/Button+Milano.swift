import MilanoSDK
import SwiftUI

extension ButtonModel {
    init(node: MilanoNode) {
        self.init(
            label: node.property("label").stringValue ?? "",
            isEnabled: node.property("enabled").boolValue ?? true,
            onTap: { node.emit("tap") })
    }
}

final class ButtonRenderer: MilanoRenderer {
    func render(_ node: MilanoNode) -> AnyView {
        guard node.isVisible else { return AnyView(EmptyView()) }
        return AnyView(PrimaryButton(model: ButtonModel(node: node)))
    }
}
