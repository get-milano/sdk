package dev.getmilano.sample.designsystem

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics

/**
 * Semantic text: the role states intent, this design system decides looks
 * and the matching assistive-technology semantics (a title is a heading;
 * a live region announces its changes).
 */
data class TextModel(
    val text: String,
    val role: Role = Role.BODY,
    val liveRegion: LiveRegion? = null,
) {
    enum class Role { TITLE, SUBTITLE, BODY }

    enum class LiveRegion { POLITE, ASSERTIVE }
}

@Composable
fun StyledText(model: TextModel) {
    val modifier =
        Modifier.semantics {
            if (model.role == TextModel.Role.TITLE) heading()
            when (model.liveRegion) {
                TextModel.LiveRegion.POLITE -> {
                    liveRegion = LiveRegionMode.Polite
                }

                TextModel.LiveRegion.ASSERTIVE -> {
                    liveRegion = LiveRegionMode.Assertive
                }

                null -> {}
            }
        }
    when (model.role) {
        TextModel.Role.TITLE -> Text(model.text, style = MaterialTheme.typography.titleLarge, modifier = modifier)
        TextModel.Role.SUBTITLE -> Text(model.text, style = MaterialTheme.typography.bodyMedium, modifier = modifier)
        TextModel.Role.BODY -> Text(model.text, style = MaterialTheme.typography.bodyLarge, modifier = modifier)
    }
}
