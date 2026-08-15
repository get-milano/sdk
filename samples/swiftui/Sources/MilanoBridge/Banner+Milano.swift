import MilanoSDK
import SwiftUI

extension BannerModel {
    init(node: MilanoNode) {
        self.init()
        switch node.property("layout").stringValue {
        case "card": layout = .card
        case "strip": layout = .strip
        default: layout = .overlay
        }
        imageURL = node.property("backgroundImageUrl").stringValue.flatMap(URL.init(string:))
        if let height = node.property("height").intValue {
            self.height = CGFloat(height)
        } else {
            height = layout == .card ? 170 : 260
        }
        switch node.property("contentAlignment").stringValue {
        case "topLeading": contentAlignment = .topLeading
        case "topTrailing": contentAlignment = .topTrailing
        case "center": contentAlignment = .center
        case "bottomTrailing": contentAlignment = .bottomTrailing
        default: contentAlignment = .bottomLeading
        }
        showScrim = node.property("showScrim").boolValue ?? true
        cornerRadius = CGFloat(node.property("cornerRadius").intValue ?? 16)
    }
}

final class BannerRenderer: MilanoRenderer {
    func render(_ node: MilanoNode) -> AnyView {
        guard node.isVisible else { return AnyView(EmptyView()) }
        return AnyView(
            BannerView(model: BannerModel(node: node)) {
                ForEach(node.children) { $0 }
            }
        )
    }
}
