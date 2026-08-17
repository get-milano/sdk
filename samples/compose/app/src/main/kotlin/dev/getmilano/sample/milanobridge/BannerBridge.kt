package dev.getmilano.sample.milanobridge

import androidx.compose.runtime.Composable
import androidx.compose.runtime.key
import androidx.compose.ui.Alignment
import dev.getmilano.MilanoNode
import dev.getmilano.MilanoRenderer
import dev.getmilano.sample.designsystem.BannerModel
import dev.getmilano.sample.designsystem.BannerView

internal fun BannerModel(banner: BannerNode): BannerModel {
    val layout =
        when (banner.layout) {
            BannerLayout.Card -> BannerModel.Layout.CARD
            BannerLayout.Strip -> BannerModel.Layout.STRIP
            BannerLayout.Overlay, null -> BannerModel.Layout.OVERLAY
        }
    return BannerModel(
        layout = layout,
        imageUrl = banner.backgroundImageUrl,
        height =
            banner.height?.toInt()
                ?: if (layout == BannerModel.Layout.CARD) 170 else 260,
        contentAlignment =
            when (banner.contentAlignment) {
                BannerContentAlignment.TopLeading -> Alignment.TopStart
                BannerContentAlignment.TopTrailing -> Alignment.TopEnd
                BannerContentAlignment.Center -> Alignment.Center
                BannerContentAlignment.BottomTrailing -> Alignment.BottomEnd
                BannerContentAlignment.BottomLeading, null -> Alignment.BottomStart
            },
        showScrim = banner.showScrim ?: true,
        cornerRadius = banner.cornerRadius?.toInt() ?: 16,
    )
}

internal object BannerRenderer : MilanoRenderer {
    @Composable
    override fun Render(node: MilanoNode) {
        val banner = BannerNode(node)
        if (banner.visible == false) return
        // The impression, for banner analytics: reported once when the
        // banner first appears on screen.
        androidx.compose.runtime.LaunchedEffect(Unit) {
            node.userInteraction(dev.getmilano.MilanoUserInteraction.Kind.APPEARED)
        }
        BannerView(BannerModel(banner)) {
            for (child in node.children) {
                key(child.key) { child.Render() }
            }
        }
    }
}
