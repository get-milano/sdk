package dev.getmilano.sample.designsystem

import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp

/**
 * A control whose point is the press, not the tap: the card detail shows
 * its numbers while a finger is down and hides them on release, so both
 * edges are reported and there is no click in between.
 */
data class PressableIconModel(
    val icon: Icon,
    val accessibilityLabel: String,
    val accessibilityHint: String? = null,
    val onPressStart: () -> Unit,
    val onPressEnd: () -> Unit,
) {
    enum class Icon { EYE, EYE_OFF }
}

@Composable
fun PressableIcon(model: PressableIconModel) {
    val interactions = remember { MutableInteractionSource() }
    Box(
        contentAlignment = Alignment.Center,
        modifier =
            Modifier
                .size(44.dp)
                .background(MaterialTheme.colorScheme.secondaryContainer, CircleShape)
                .semantics {
                    contentDescription = model.accessibilityLabel
                    role = Role.Button
                    // Assistive technology has no press-and-hold: activating
                    // the control reveals and immediately hides, which is
                    // the honest mapping of a momentary reveal.
                    onClick(label = model.accessibilityHint) {
                        model.onPressStart()
                        model.onPressEnd()
                        true
                    }
                }.pointerInput(interactions) {
                    awaitPointerEventScope {
                        while (true) {
                            awaitPointerEvent()
                            val down = currentEvent.changes.any { it.pressed }
                            if (down) {
                                model.onPressStart()
                                do {
                                    awaitPointerEvent()
                                } while (currentEvent.changes.any { it.pressed })
                                model.onPressEnd()
                            }
                        }
                    }
                },
    ) {
        Icon(
            imageVector =
                when (model.icon) {
                    PressableIconModel.Icon.EYE -> Icons.Filled.Visibility
                    PressableIconModel.Icon.EYE_OFF -> Icons.Filled.VisibilityOff
                },
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSecondaryContainer,
        )
    }
}
