import MilanoSDK
import SwiftUI

extension ToggleModel {
    init(_ checkbox: SampleCheckboxNode) {
        self.init(
            label: checkbox.label,
            isOn: checkbox.checked,
            onChange: { checkbox.emitChange($0) })
    }
}

final class CheckboxRenderer: MilanoRenderer {
    func render(_ node: MilanoNode) -> AnyView {
        let checkbox = SampleCheckboxNode(node)
        guard checkbox.visible ?? true else { return AnyView(EmptyView()) }
        return AnyView(LabeledToggle(model: ToggleModel(checkbox)))
    }
}
