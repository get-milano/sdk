import MilanoSDK
import SwiftUI

extension NumberFieldModel {
    init(_ field: SampleNumberFieldNode) {
        self.init(
            label: field.label,
            value: field.value,
            onChange: { field.emitChange($0) })
    }
}

final class NumberFieldRenderer: MilanoRenderer {
    func render(_ node: MilanoNode) -> AnyView {
        let field = SampleNumberFieldNode(node)
        guard field.visible ?? true else { return AnyView(EmptyView()) }
        return AnyView(LabeledNumberField(model: NumberFieldModel(field)))
    }
}
