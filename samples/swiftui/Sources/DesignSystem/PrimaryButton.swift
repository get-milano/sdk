import SwiftUI

struct ButtonModel {
    var label: String
    var isEnabled = true
    var onTap: () -> Void = {}
}

struct PrimaryButton: View {
    let model: ButtonModel

    var body: some View {
        Button(model.label, action: model.onTap)
            .buttonStyle(.borderedProminent)
            .disabled(!model.isEnabled)
    }
}
