import MilanoSDK
import SwiftUI

extension IconModel {
    init(_ icon: SampleIconNode) {
        // `icon.name` is the generated enum, not a string: a document can
        // only ask for an icon this design system draws, and a member
        // added to the vocabulary fails this switch until it is covered.
        let name: Name
        switch icon.name {
        case .person: name = .person
        case .list: name = .list
        case .search: name = .search
        case .edit: name = .edit
        case .settings: name = .settings
        case .help: name = .help
        }
        let container: Container
        switch icon.container ?? .plain {
        case .circle: container = .circle
        case .plain: container = .none
        }
        self.init(name: name, container: container)
    }
}

final class IconRenderer: MilanoRenderer {
    func render(_ node: MilanoNode) -> AnyView {
        let icon = SampleIconNode(node)
        guard icon.visible ?? true else { return AnyView(EmptyView()) }
        return AnyView(IconView(model: IconModel(icon)))
    }
}
