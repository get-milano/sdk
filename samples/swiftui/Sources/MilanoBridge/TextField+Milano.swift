import MilanoSDK
import SwiftUI

extension TextFieldModel {
    init(node: MilanoNode) {
        self.init(
            label: node.property("label").stringValue ?? "",
            value: node.property("value").stringValue ?? "",
            isRequired: node.property("required").boolValue ?? false,
            error: node.property("error").stringValue,
            onChange: { node.emit("change", payload: .string($0)) })
    }
}

final class TextFieldRenderer: MilanoRenderer {
    func render(_ node: MilanoNode) -> AnyView {
        guard node.isVisible else { return AnyView(EmptyView()) }
        return AnyView(LabeledTextField(model: TextFieldModel(node: node)))
    }
}
