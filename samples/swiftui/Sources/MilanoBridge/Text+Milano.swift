import MilanoSDK
import SwiftUI

extension TextModel {
    init(node: MilanoNode) {
        let role: Role
        switch node.property("role").stringValue {
        case "title": role = .title
        case "subtitle": role = .subtitle
        default: role = .body
        }
        self.init(text: node.property("text").stringValue ?? "", role: role)
    }
}

final class TextRenderer: MilanoRenderer {
    func render(_ node: MilanoNode) -> AnyView {
        guard node.isVisible else { return AnyView(EmptyView()) }
        return AnyView(StyledText(model: TextModel(node: node)))
    }
}
