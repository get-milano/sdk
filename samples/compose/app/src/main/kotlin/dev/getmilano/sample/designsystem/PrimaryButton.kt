package dev.getmilano.sample.designsystem

import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable

data class ButtonModel(
    val label: String,
    val isEnabled: Boolean = true,
    val onTap: () -> Unit = {},
)

@Composable
fun PrimaryButton(model: ButtonModel) {
    Button(onClick = model.onTap, enabled = model.isEnabled) {
        Text(model.label)
    }
}
