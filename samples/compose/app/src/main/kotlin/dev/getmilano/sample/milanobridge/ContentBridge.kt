package dev.getmilano.sample.milanobridge

import androidx.compose.runtime.Composable
import androidx.compose.runtime.key
import dev.getmilano.MilanoNode
import dev.getmilano.MilanoRenderer
import dev.getmilano.MilanoValue
import dev.getmilano.sample.designsystem.ButtonModel
import dev.getmilano.sample.designsystem.CheckboxModel
import dev.getmilano.sample.designsystem.ColumnContainer
import dev.getmilano.sample.designsystem.LabeledCheckbox
import dev.getmilano.sample.designsystem.LabeledNumberField
import dev.getmilano.sample.designsystem.LabeledTextField
import dev.getmilano.sample.designsystem.NumberFieldModel
import dev.getmilano.sample.designsystem.PrimaryButton
import dev.getmilano.sample.designsystem.StyledText
import dev.getmilano.sample.designsystem.TextFieldModel
import dev.getmilano.sample.designsystem.TextModel

internal fun TextModel(node: MilanoNode): TextModel =
    TextModel(
        text = node.property("text").stringOrNull ?: "",
        role =
            when (node.property("role").stringOrNull) {
                "title" -> TextModel.Role.TITLE
                "subtitle" -> TextModel.Role.SUBTITLE
                else -> TextModel.Role.BODY
            },
    )

internal fun ButtonModel(node: MilanoNode): ButtonModel =
    ButtonModel(
        label = node.property("label").stringOrNull ?: "",
        isEnabled = node.property("enabled").boolOrNull ?: true,
        onTap = { node.emit("tap") },
    )

internal fun TextFieldModel(node: MilanoNode): TextFieldModel =
    TextFieldModel(
        label = node.property("label").stringOrNull ?: "",
        value = node.property("value").stringOrNull ?: "",
        isRequired = node.property("required").boolOrNull ?: false,
        error = node.property("error").stringOrNull,
        onChange = { node.emit("change", MilanoValue.StringValue(it)) },
    )

internal fun NumberFieldModel(node: MilanoNode): NumberFieldModel =
    NumberFieldModel(
        label = node.property("label").stringOrNull ?: "",
        value = node.property("value").doubleOrNull ?: 0.0,
        onChange = { node.emit("change", MilanoValue.DoubleValue(it)) },
    )

internal fun CheckboxModel(node: MilanoNode): CheckboxModel =
    CheckboxModel(
        label = node.property("label").stringOrNull ?: "",
        isChecked = node.property("checked").boolOrNull ?: false,
        onChange = { node.emit("change", MilanoValue.BoolValue(it)) },
    )

internal object TextRenderer : MilanoRenderer {
    @Composable
    override fun Render(node: MilanoNode) {
        if (!node.isVisible) return
        StyledText(TextModel(node))
    }
}

internal object ButtonRenderer : MilanoRenderer {
    @Composable
    override fun Render(node: MilanoNode) {
        if (!node.isVisible) return
        PrimaryButton(ButtonModel(node))
    }
}

internal object TextFieldRenderer : MilanoRenderer {
    @Composable
    override fun Render(node: MilanoNode) {
        if (!node.isVisible) return
        LabeledTextField(TextFieldModel(node))
    }
}

internal object NumberFieldRenderer : MilanoRenderer {
    @Composable
    override fun Render(node: MilanoNode) {
        if (!node.isVisible) return
        LabeledNumberField(NumberFieldModel(node))
    }
}

internal object CheckboxRenderer : MilanoRenderer {
    @Composable
    override fun Render(node: MilanoNode) {
        if (!node.isVisible) return
        LabeledCheckbox(CheckboxModel(node))
    }
}

internal object ColumnRenderer : MilanoRenderer {
    @Composable
    override fun Render(node: MilanoNode) {
        ColumnContainer {
            for (child in node.children) {
                key(child.key) { child.Render() }
            }
        }
    }
}
