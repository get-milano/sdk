import MilanoSDK
import SwiftUI

extension TextModel {
    init(_ text: SampleTextNode) {
        let role: Role
        switch text.role {
        case .title: role = .title
        case .subtitle: role = .subtitle
        case .body, nil: role = .body
        }
        let liveRegion: LiveRegion?
        switch text.liveRegion {
        case .polite: liveRegion = .polite
        case .assertive: liveRegion = .assertive
        case nil: liveRegion = nil
        }
        self.init(text: text.text, role: role, liveRegion: liveRegion)
    }
}

final class TextRenderer: MilanoRenderer {
    func render(_ node: MilanoNode) -> AnyView {
        let text = SampleTextNode(node)
        guard text.visible ?? true else { return AnyView(EmptyView()) }
        return AnyView(StyledText(model: TextModel(text)))
    }
}
