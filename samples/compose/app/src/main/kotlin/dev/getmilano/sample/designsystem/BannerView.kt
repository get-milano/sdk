package dev.getmilano.sample.designsystem

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage

/** A promotional surface. Pure UI: knows nothing about Milano. */
data class BannerModel(
    val layout: Layout = Layout.OVERLAY,
    val imageUrl: String? = null,
    val height: Int = 260,
    val contentAlignment: Alignment = Alignment.BottomStart,
    val showScrim: Boolean = true,
    val cornerRadius: Int = 16,
) {
    enum class Layout { OVERLAY, CARD, STRIP }
}

@Composable
fun BannerView(
    model: BannerModel,
    content: @Composable () -> Unit,
) {
    when (model.layout) {
        BannerModel.Layout.OVERLAY -> OverlayLayout(model, content)
        BannerModel.Layout.CARD -> CardLayout(model, content)
        BannerModel.Layout.STRIP -> StripLayout(model, content)
    }
}

/** Content over the image, scrim for legibility. */
@Composable
private fun OverlayLayout(
    model: BannerModel,
    content: @Composable () -> Unit,
) {
    Box(
        modifier =
            Modifier
                .padding(16.dp)
                .fillMaxWidth()
                .height(model.height.dp)
                .clip(RoundedCornerShape(model.cornerRadius.dp)),
    ) {
        BannerImage(model)
        if (model.showScrim) {
            Box(
                modifier =
                    Modifier
                        .matchParentSize()
                        .background(
                            Brush.verticalGradient(
                                listOf(Color.Transparent, Color.Black.copy(alpha = 0.65f)),
                            ),
                        ),
            )
        }
        CompositionLocalProvider(LocalContentColor provides Color.White) {
            Column(
                modifier =
                    Modifier
                        .align(model.contentAlignment)
                        .padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                content()
            }
        }
    }
}

/** Image on top, content below on a surface. */
@Composable
private fun CardLayout(
    model: BannerModel,
    content: @Composable () -> Unit,
) {
    Column(
        modifier =
            Modifier
                .padding(16.dp)
                .fillMaxWidth()
                .clip(RoundedCornerShape(model.cornerRadius.dp))
                .background(MaterialTheme.colorScheme.surfaceVariant),
    ) {
        Box(modifier = Modifier.fillMaxWidth().height(model.height.dp)) {
            BannerImage(model)
        }
        Column(
            modifier = Modifier.fillMaxWidth().padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            content()
        }
    }
}

/** A slim, imageless announcement row. */
@Composable
private fun StripLayout(
    model: BannerModel,
    content: @Composable () -> Unit,
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        modifier =
            Modifier
                .padding(16.dp)
                .fillMaxWidth()
                .clip(RoundedCornerShape(model.cornerRadius.dp))
                .background(MaterialTheme.colorScheme.secondaryContainer)
                .padding(14.dp),
    ) {
        content()
    }
}

@Composable
private fun BannerImage(model: BannerModel) {
    Box(modifier = Modifier.fillMaxWidth().height(400.dp)) {
        Box(
            modifier =
                Modifier
                    .matchParentSize()
                    .background(
                        Brush.linearGradient(
                            listOf(Color(0xFF3F51B5), Color(0xFF009688)),
                        ),
                    ),
        )
        AsyncImage(
            model = model.imageUrl,
            contentDescription = null,
            contentScale = ContentScale.Crop,
            modifier = Modifier.matchParentSize(),
        )
    }
}
