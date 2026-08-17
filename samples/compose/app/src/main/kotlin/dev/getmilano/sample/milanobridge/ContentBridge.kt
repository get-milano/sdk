package dev.getmilano.sample.milanobridge

import androidx.compose.runtime.Composable
import androidx.compose.runtime.key
import dev.getmilano.MilanoNode
import dev.getmilano.MilanoRenderer
import dev.getmilano.MilanoUserInteraction
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

internal fun TextModel(text: TextNode): TextModel =
    TextModel(
        text = text.text,
        role =
            when (text.role) {
                TextRole.Title -> TextModel.Role.TITLE
                TextRole.Subtitle -> TextModel.Role.SUBTITLE
                TextRole.Body, null -> TextModel.Role.BODY
            },
        liveRegion =
            when (text.liveRegion) {
                TextLiveRegion.Polite -> TextModel.LiveRegion.POLITE
                TextLiveRegion.Assertive -> TextModel.LiveRegion.ASSERTIVE
                null -> null
            },
    )

internal fun ButtonModel(button: ButtonNode): ButtonModel =
    ButtonModel(
        label = button.label,
        isEnabled = button.enabled,
        onTap = { button.emitTap() },
    )

internal fun TextFieldModel(field: TextFieldNode): TextFieldModel =
    TextFieldModel(
        label = field.label,
        value = field.value,
        isRequired = field.required ?: false,
        error = field.error,
        onChange = { field.emitChange(it) },
        // Focus is analytics-only: not a document event, so it flows
        // through the user-interaction stream, never through dispatch.
        onFocusChange = { focused ->
            field.node.userInteraction(
                if (focused) {
                    MilanoUserInteraction.Kind.FOCUS_GAINED
                } else {
                    MilanoUserInteraction.Kind.FOCUS_LOST
                },
            )
        },
    )

internal fun NumberFieldModel(field: NumberFieldNode): NumberFieldModel =
    NumberFieldModel(
        label = field.label,
        value = field.value,
        onChange = { field.emitChange(it) },
    )

internal fun CheckboxModel(checkbox: CheckboxNode): CheckboxModel =
    CheckboxModel(
        label = checkbox.label,
        isChecked = checkbox.checked,
        onChange = { checkbox.emitChange(it) },
    )

internal object TextRenderer : MilanoRenderer {
    @Composable
    override fun Render(node: MilanoNode) {
        val text = TextNode(node)
        if (text.visible == false) return
        StyledText(TextModel(text))
    }
}

internal object ButtonRenderer : MilanoRenderer {
    @Composable
    override fun Render(node: MilanoNode) {
        val button = ButtonNode(node)
        if (button.visible == false) return
        PrimaryButton(ButtonModel(button))
    }
}

internal object TextFieldRenderer : MilanoRenderer {
    @Composable
    override fun Render(node: MilanoNode) {
        val field = TextFieldNode(node)
        if (field.visible == false) return
        LabeledTextField(TextFieldModel(field))
    }
}

internal object NumberFieldRenderer : MilanoRenderer {
    @Composable
    override fun Render(node: MilanoNode) {
        val field = NumberFieldNode(node)
        if (field.visible == false) return
        LabeledNumberField(NumberFieldModel(field))
    }
}

internal object CheckboxRenderer : MilanoRenderer {
    @Composable
    override fun Render(node: MilanoNode) {
        val checkbox = CheckboxNode(node)
        if (checkbox.visible == false) return
        LabeledCheckbox(CheckboxModel(checkbox))
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
