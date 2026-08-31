package dev.getmilano.sample.designsystem

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.List
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp

/**
 * Semantic icon: a document names a meaning, never a drawable, and this
 * design system decides what the meaning looks like. Material icons here,
 * SF Symbols in the SwiftUI sample, emoji in the React Native one, all
 * from the same document.
 *
 * [Container] is the second thing a document may say: whether the icon
 * stands alone or is shown inside something. What "inside something"
 * looks like, a tinted circle of this size, is decided here.
 */
data class IconModel(
    val name: Name,
    val container: Container = Container.NONE,
) {
    enum class Name { PERSON, LIST, SEARCH, EDIT, SETTINGS, HELP }

    enum class Container { NONE, CIRCLE }
}

private val CIRCLE = 56.dp

@Composable
fun IconView(model: IconModel) {
    val image: ImageVector =
        when (model.name) {
            IconModel.Name.PERSON -> Icons.Filled.Person
            IconModel.Name.LIST -> Icons.Filled.List
            IconModel.Name.SEARCH -> Icons.Filled.Search
            IconModel.Name.EDIT -> Icons.Filled.Edit
            IconModel.Name.SETTINGS -> Icons.Filled.Settings
            IconModel.Name.HELP -> Icons.Filled.Info
        }
    when (model.container) {
        IconModel.Container.NONE -> {
            // Decorative: whatever contains the icon carries the label and
            // the accessibility label, so describing the glyph as well
            // would read the same thing twice.
            Icon(image, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
        }

        IconModel.Container.CIRCLE -> {
            Box(
                contentAlignment = Alignment.Center,
                modifier =
                    Modifier
                        .size(CIRCLE)
                        .background(MaterialTheme.colorScheme.secondaryContainer, CircleShape),
            ) {
                Icon(
                    image,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onSecondaryContainer,
                )
            }
        }
    }
}
