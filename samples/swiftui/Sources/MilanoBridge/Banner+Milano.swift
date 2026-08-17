import MilanoSDK
import SwiftUI

extension BannerModel {
    init(_ banner: SampleBannerNode) {
        self.init()
        switch banner.layout {
        case .card: layout = .card
        case .strip: layout = .strip
        case .overlay, nil: layout = .overlay
        }
        imageURL = banner.backgroundImageUrl.flatMap(URL.init(string:))
        if let height = banner.height {
            self.height = CGFloat(height)
        } else {
            height = layout == .card ? 170 : 260
        }
        switch banner.contentAlignment {
        case .topLeading: contentAlignment = .topLeading
        case .topTrailing: contentAlignment = .topTrailing
        case .center: contentAlignment = .center
        case .bottomTrailing: contentAlignment = .bottomTrailing
        case .bottomLeading, nil: contentAlignment = .bottomLeading
        }
        showScrim = banner.showScrim ?? true
        cornerRadius = CGFloat(banner.cornerRadius ?? 16)
    }
}

final class BannerRenderer: MilanoRenderer {
    func render(_ node: MilanoNode) -> AnyView {
        let banner = SampleBannerNode(node)
        guard banner.visible ?? true else { return AnyView(EmptyView()) }
        return AnyView(
            BannerView(model: BannerModel(banner)) {
                ForEach(node.children) { $0 }
            }
            // The impression, for banner analytics: reported once when the
            // banner first appears on screen.
            .onAppear { node.userInteraction(.appeared) }
        )
    }
}
