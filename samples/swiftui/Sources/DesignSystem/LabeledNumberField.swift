import SwiftUI

/// A numeric input field. Parsing is the renderer's job: the document only
/// ever sees typed doubles, which is what keeps expressions total.
struct NumberFieldModel {
    var label: String
    var value: Double
    var onChange: (Double) -> Void = { _ in }
}

struct LabeledNumberField: View {
    let model: NumberFieldModel
    @State private var text = ""

    var body: some View {
        TextField(model.label, text: $text)
            .textFieldStyle(.roundedBorder)
            #if os(iOS)
                .keyboardType(.decimalPad)
            #endif
            .onAppear {
                if model.value != 0 { text = Self.display(model.value) }
            }
            .onChange(of: text) { newValue in
                if newValue.isEmpty {
                    model.onChange(0)
                } else if let parsed = Double(newValue.replacingOccurrences(of: ",", with: ".")) {
                    model.onChange(parsed)
                }
            }
    }

    private static func display(_ value: Double) -> String {
        value.truncatingRemainder(dividingBy: 1) == 0
            ? String(Int(value)) : String(value)
    }
}
