import SwiftUI

#if canImport(UIKit)
    import UIKit
#endif

/// Semantic text: the role states intent, this design system decides looks
/// and the matching assistive-technology semantics (a title is a heading;
/// a live region announces its changes).
struct TextModel {
    enum Role {
        case title
        case subtitle
        case body
    }

    enum LiveRegion {
        case polite
        case assertive
    }

    var text: String
    var role: Role = .body
    var liveRegion: LiveRegion?
}

struct StyledText: View {
    let model: TextModel

    var body: some View {
        styled
            .accessibilityAddTraits(model.role == .title ? .isHeader : [])
            .onChange(of: model.text) { newValue in
                // SwiftUI has no live regions; the closest honest mapping
                // is announcing the new value when it changes.
                guard model.liveRegion != nil, !newValue.isEmpty else { return }
                #if canImport(UIKit)
                    UIAccessibility.post(notification: .announcement, argument: newValue)
                #endif
            }
    }

    @ViewBuilder
    private var styled: some View {
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
