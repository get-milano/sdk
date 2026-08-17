import SwiftUI

/// A form field with a mandatory marker and an inline error message.
struct TextFieldModel {
    var label: String
    var value: String
    var isRequired = false
    var error: String?
    var onChange: (String) -> Void = { _ in }
    var onFocusChange: (Bool) -> Void = { _ in }
}

struct LabeledTextField: View {
    let model: TextFieldModel
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            TextField(
                title,
                text: Binding(get: { model.value }, set: model.onChange)
            )
            .textFieldStyle(.roundedBorder)
            .focused($focused)
            .onChange(of: focused) { model.onFocusChange($0) }
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
