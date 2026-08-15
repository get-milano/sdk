import SwiftUI

struct ToggleModel {
    var label: String
    var isOn: Bool
    var onChange: (Bool) -> Void = { _ in }
}

struct LabeledToggle: View {
    let model: ToggleModel

    var body: some View {
        Toggle(model.label, isOn: Binding(get: { model.isOn }, set: model.onChange))
    }
}
