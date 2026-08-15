package dev.getmilano.sample.designsystem

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Row
import androidx.compose.material3.Checkbox
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier

data class CheckboxModel(
    val label: String,
    val isChecked: Boolean,
    val onChange: (Boolean) -> Unit = {},
)

@Composable
fun LabeledCheckbox(model: CheckboxModel) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier.clickable { model.onChange(!model.isChecked) },
    ) {
        Checkbox(checked = model.isChecked, onCheckedChange = model.onChange)
        Text(model.label)
    }
}
