import MilanoSDK
import SwiftUI

final class ColumnRenderer: MilanoRenderer {
    func render(_ node: MilanoNode) -> AnyView {
        let column = SampleColumnNode(node)
        return AnyView(
            ColumnContainer(
                padding: CGFloat(column.padding ?? 16),
                fillsWidth: column.width != .content
            ) {
                ForEach(node.children) { $0 }
            }
        )
    }
}
