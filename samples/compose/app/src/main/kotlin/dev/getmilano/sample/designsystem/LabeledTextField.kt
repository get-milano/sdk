package dev.getmilano.sample.designsystem

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.onFocusChanged

/** A form field with a mandatory marker and an inline error message. */
data class TextFieldModel(
    val label: String,
    val value: String,
    val isRequired: Boolean = false,
    val error: String? = null,
    val onChange: (String) -> Unit = {},
    val onFocusChange: (Boolean) -> Unit = {},
)

@Composable
fun LabeledTextField(model: TextFieldModel) {
    val title = if (model.isRequired) "${model.label} *" else model.label
    OutlinedTextField(
        value = model.value,
        onValueChange = model.onChange,
        label = { Text(title) },
        isError = model.error != null,
        supportingText =
            model.error?.let { error ->
                { Text(error, color = MaterialTheme.colorScheme.error) }
            },
        modifier =
            Modifier
                .fillMaxWidth()
                .onFocusChanged { state -> model.onFocusChange(state.isFocused) },
    )
}
