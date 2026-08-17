import MilanoSDK
import SwiftUI

extension TextFieldModel {
    init(_ field: SampleTextFieldNode) {
        self.init(
            label: field.label,
            value: field.value,
            isRequired: field.required ?? false,
            error: field.error,
            onChange: { field.emitChange($0) },
            // Focus is analytics-only: not a document event, so it flows
            // through the user-interaction stream, never through dispatch.
            onFocusChange: { focused in
                field.node.userInteraction(focused ? .focusGained : .focusLost)
            })
    }
}

final class TextFieldRenderer: MilanoRenderer {
    func render(_ node: MilanoNode) -> AnyView {
        let field = SampleTextFieldNode(node)
        guard field.visible ?? true else { return AnyView(EmptyView()) }
        return AnyView(LabeledTextField(model: TextFieldModel(field)))
    }
}
