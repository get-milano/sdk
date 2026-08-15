package dev.getmilano.sample.designsystem

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable

/** Semantic text: the role states intent, this design system decides looks. */
data class TextModel(
    val text: String,
    val role: Role = Role.BODY,
) {
    enum class Role { TITLE, SUBTITLE, BODY }
}

@Composable
fun StyledText(model: TextModel) {
    when (model.role) {
        TextModel.Role.TITLE -> Text(model.text, style = MaterialTheme.typography.titleLarge)
        TextModel.Role.SUBTITLE -> Text(model.text, style = MaterialTheme.typography.bodyMedium)
        TextModel.Role.BODY -> Text(model.text, style = MaterialTheme.typography.bodyLarge)
    }
}
