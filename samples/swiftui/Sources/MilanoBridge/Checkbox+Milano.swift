import MilanoSDK
import SwiftUI

extension ToggleModel {
    init(node: MilanoNode) {
        self.init(
            label: node.property("label").stringValue ?? "",
            isOn: node.property("checked").boolValue ?? false,
            onChange: { node.emit("change", payload: .bool($0)) })
    }
}

final class CheckboxRenderer: MilanoRenderer {
    func render(_ node: MilanoNode) -> AnyView {
        guard node.isVisible else { return AnyView(EmptyView()) }
        return AnyView(LabeledToggle(model: ToggleModel(node: node)))
    }
}
