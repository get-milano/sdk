package dev.getmilano.sample.milanobridge

import androidx.compose.runtime.Composable
import androidx.compose.runtime.key
import androidx.compose.ui.Alignment
import dev.getmilano.MilanoNode
import dev.getmilano.MilanoRenderer
import dev.getmilano.sample.designsystem.BannerModel
import dev.getmilano.sample.designsystem.BannerView

internal fun BannerModel(node: MilanoNode): BannerModel {
    val layout =
        when (node.property("layout").stringOrNull) {
            "card" -> BannerModel.Layout.CARD
            "strip" -> BannerModel.Layout.STRIP
            else -> BannerModel.Layout.OVERLAY
        }
    return BannerModel(
        layout = layout,
        imageUrl = node.property("backgroundImageUrl").stringOrNull,
        height =
            node.property("height").intOrNull?.toInt()
                ?: if (layout == BannerModel.Layout.CARD) 170 else 260,
        contentAlignment =
            when (node.property("contentAlignment").stringOrNull) {
                "topLeading" -> Alignment.TopStart
                "topTrailing" -> Alignment.TopEnd
                "center" -> Alignment.Center
                "bottomTrailing" -> Alignment.BottomEnd
                else -> Alignment.BottomStart
            },
        showScrim = node.property("showScrim").boolOrNull ?: true,
        cornerRadius = node.property("cornerRadius").intOrNull?.toInt() ?: 16,
    )
}

internal object BannerRenderer : MilanoRenderer {
    @Composable
    override fun Render(node: MilanoNode) {
        if (!node.isVisible) return
        BannerView(BannerModel(node)) {
            for (child in node.children) {
                key(child.key) { child.Render() }
            }
        }
    }
}
