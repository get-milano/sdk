import MilanoSDK
import SwiftUI

extension NumberFieldModel {
    init(node: MilanoNode) {
        self.init(
            label: node.property("label").stringValue ?? "",
            value: node.property("value").doubleValue ?? 0,
            onChange: { node.emit("change", payload: .double($0)) })
    }
}

final class NumberFieldRenderer: MilanoRenderer {
    func render(_ node: MilanoNode) -> AnyView {
        guard node.isVisible else { return AnyView(EmptyView()) }
        return AnyView(LabeledNumberField(model: NumberFieldModel(node: node)))
    }
}
