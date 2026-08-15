import MilanoSDK
import SwiftUI

final class ColumnRenderer: MilanoRenderer {
    func render(_ node: MilanoNode) -> AnyView {
        AnyView(
            ColumnContainer {
                ForEach(node.children) { $0 }
            }
        )
    }
}
