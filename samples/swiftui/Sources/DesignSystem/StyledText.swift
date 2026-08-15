import SwiftUI

/// Semantic text: the role states intent, this design system decides looks.
struct TextModel {
    enum Role {
        case title
        case subtitle
        case body
    }

    var text: String
    var role: Role = .body
}

struct StyledText: View {
    let model: TextModel

    var body: some View {
        switch model.role {
        case .title:
            Text(model.text).font(.title3.weight(.semibold))
        case .subtitle:
            Text(model.text).font(.subheadline).opacity(0.85)
        case .body:
            Text(model.text).font(.body)
        }
    }
}
