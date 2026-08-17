package dev.getmilano.sample.milanobridge

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
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
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy((row.spacing ?: 8).toInt().dp),
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
        var modifier =
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape((card.cornerRadius ?: 12).toInt().dp))
                .background(MaterialTheme.colorScheme.surfaceVariant)
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
