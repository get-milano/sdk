import SwiftUI

/// A form field with a mandatory marker and an inline error message.
struct TextFieldModel {
    var label: String
    var value: String
    var isRequired = false
    var error: String?
    var onChange: (String) -> Void = { _ in }
}

struct LabeledTextField: View {
    let model: TextFieldModel

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            TextField(
                title,
                text: Binding(get: { model.value }, set: model.onChange)
            )
            .textFieldStyle(.roundedBorder)
            if let error = model.error {
                Text(error)
                    .font(.caption)
                    .foregroundColor(.red)
            }
        }
    }

    private var title: String {
        model.isRequired ? "\(model.label) *" : model.label
    }
}
