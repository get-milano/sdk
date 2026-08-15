package dev.getmilano.sample.designsystem

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType

/**
 * A numeric input field. Parsing is the renderer's job: the document only
 * ever sees typed doubles, which is what keeps expressions total.
 */
data class NumberFieldModel(
    val label: String,
    val value: Double,
    val onChange: (Double) -> Unit = {},
)

@Composable
fun LabeledNumberField(model: NumberFieldModel) {
    var text by remember { mutableStateOf(if (model.value == 0.0) "" else display(model.value)) }
    OutlinedTextField(
        value = text,
        onValueChange = { entered ->
            text = entered
            when {
                entered.isEmpty() -> model.onChange(0.0)
                else -> entered.replace(',', '.').toDoubleOrNull()?.let(model.onChange)
            }
        },
        label = { Text(model.label) },
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
        modifier = Modifier.fillMaxWidth(),
    )
}

private fun display(value: Double): String = if (value % 1.0 == 0.0) value.toLong().toString() else value.toString()
