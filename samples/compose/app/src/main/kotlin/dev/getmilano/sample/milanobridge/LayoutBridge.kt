package dev.getmilano.sample.milanobridge

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.key
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import dev.getmilano.MilanoNode
import dev.getmilano.MilanoRenderer

/**
 * The layout and media primitives behind the profile and catalog screens:
 * generic containers and an image, everything meaningful still declared in
 * the documents.
 */
internal object RowRenderer : MilanoRenderer {
    @Composable
    override fun Render(node: MilanoNode) {
        val row = RowNode(node)
        // Top alignment is what keeps a strip of tiles readable: labels
        // wrap to different heights, and centring them would leave the
        // icons on different lines.
        val alignment =
            when (row.alignment) {
                RowAlignment.Top -> Alignment.Top
                RowAlignment.Bottom -> Alignment.Bottom
                RowAlignment.Center, null -> Alignment.CenterVertically
            }
        // A scrolling row is how a strip of tiles stays on screen whatever
        // its content: without it anything past the edge is unreachable.
        // The padding sits inside the scroll, so it reads as the strip's
        // leading and trailing inset rather than as a gap that scrolls
        // away. Opt-in, because a scrolling row gives its children
        // unbounded width, and the catalog's rows must keep wrapping.
        val base = if (row.scrolls == true) Modifier.horizontalScroll(rememberScrollState()) else Modifier
        Row(
            verticalAlignment = alignment,
            horizontalArrangement = Arrangement.spacedBy((row.spacing ?: 8).toInt().dp),
            modifier = base.padding(horizontal = (row.horizontalPadding ?: 0).toInt().dp),
        ) {
            for (child in node.children) {
                key(child.key) { child.Render() }
            }
        }
    }
}

internal object CardRenderer : MilanoRenderer {
    @Composable
    override fun Render(node: MilanoNode) {
        val card = CardNode(node)
        // `plain` is a card that is tappable without looking like a
        // surface: no fill, no width of its own, children centred. It is
        // what a strip of quick action tiles is made of, where the only
        // filled shape is the circle behind each icon.
        val plain = card.style == CardStyle.Plain
        var modifier =
            Modifier
                .then(if (plain) Modifier else Modifier.fillMaxWidth())
                .clip(RoundedCornerShape((card.cornerRadius ?: 12).toInt().dp))
                .then(
                    if (plain) {
                        Modifier
                    } else {
                        Modifier.background(MaterialTheme.colorScheme.surfaceVariant)
                    },
                )
                // Cards are tappable by design: one activatable element,
                // with the hint as the action's spoken label.
                .clickable(onClickLabel = card.accessibilityHint, role = Role.Button) {
                    card.emitTap()
                }
        card.accessibilityLabel?.let { label ->
            modifier = modifier.semantics(mergeDescendants = true) { contentDescription = label }
        }
        Column(
            verticalArrangement = Arrangement.spacedBy(8.dp),
            horizontalAlignment = if (plain) Alignment.CenterHorizontally else Alignment.Start,
            modifier = modifier.padding((card.padding ?: 12).toInt().dp),
        ) {
            for (child in node.children) {
                key(child.key) { child.Render() }
            }
        }
    }
}

internal object ImageRenderer : MilanoRenderer {
    @Composable
    override fun Render(node: MilanoNode) {
        val image = ImageNode(node)
        var modifier: Modifier = Modifier
        image.width?.let { modifier = modifier.width(it.toInt().dp) }
        image.height?.let { modifier = modifier.height(it.toInt().dp) }
        image.cornerRadius?.let { modifier = modifier.clip(RoundedCornerShape(it.toInt().dp)) }
        AsyncImage(
            model = image.url,
            // Decorative images vanish from the accessibility tree: a null
            // description marks exactly that on Android.
            contentDescription = if (image.decorative == true) null else image.contentDescription,
            contentScale = ContentScale.Crop,
            modifier = modifier,
        )
    }
}
