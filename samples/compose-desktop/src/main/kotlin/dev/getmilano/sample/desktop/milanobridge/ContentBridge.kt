package dev.getmilano.sample.desktop.milanobridge

import androidx.compose.runtime.Composable
import androidx.compose.runtime.key
import dev.getmilano.MilanoNode
import dev.getmilano.MilanoRenderer
import dev.getmilano.MilanoUserInteraction
import dev.getmilano.sample.desktop.designsystem.ButtonModel
import dev.getmilano.sample.desktop.designsystem.CheckboxModel
import dev.getmilano.sample.desktop.designsystem.ColumnContainer
import dev.getmilano.sample.desktop.designsystem.IconModel
import dev.getmilano.sample.desktop.designsystem.IconView
import dev.getmilano.sample.desktop.designsystem.LabeledCheckbox
import dev.getmilano.sample.desktop.designsystem.LabeledNumberField
import dev.getmilano.sample.desktop.designsystem.LabeledTextField
import dev.getmilano.sample.desktop.designsystem.NumberFieldModel
import dev.getmilano.sample.desktop.designsystem.PressableIcon
import dev.getmilano.sample.desktop.designsystem.PressableIconModel
import dev.getmilano.sample.desktop.designsystem.PrimaryButton
import dev.getmilano.sample.desktop.designsystem.StyledText
import dev.getmilano.sample.desktop.designsystem.TextFieldModel
import dev.getmilano.sample.desktop.designsystem.TextModel

internal fun TextModel(text: TextNode): TextModel =
    TextModel(
        text = text.text,
        role =
            when (text.role) {
                TextRole.Title -> TextModel.Role.TITLE
                TextRole.Subtitle -> TextModel.Role.SUBTITLE
                TextRole.Caption -> TextModel.Role.CAPTION
                TextRole.Body, null -> TextModel.Role.BODY
            },
        liveRegion =
            when (text.liveRegion) {
                TextLiveRegion.Polite -> TextModel.LiveRegion.POLITE
                TextLiveRegion.Assertive -> TextModel.LiveRegion.ASSERTIVE
                null -> null
            },
    )

internal fun IconModel(icon: IconNode): IconModel =
    IconModel(
        // `icon.name` is the generated enum, not a string: a document can
        // only ask for an icon this design system draws, and a member
        // added to the vocabulary fails this `when` until it is covered.
        name =
            when (icon.name) {
                IconName.Person -> IconModel.Name.PERSON
                IconName.List -> IconModel.Name.LIST
                IconName.Search -> IconModel.Name.SEARCH
                IconName.Edit -> IconModel.Name.EDIT
                IconName.Settings -> IconModel.Name.SETTINGS
                IconName.Help -> IconModel.Name.HELP
            },
        container =
            when (icon.container) {
                IconContainer.Circle -> IconModel.Container.CIRCLE
                IconContainer.Plain, null -> IconModel.Container.NONE
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

internal object IconButtonRenderer : MilanoRenderer {
    @Composable
    override fun Render(node: MilanoNode) {
        val button = IconButtonNode(node)
        PressableIcon(
            PressableIconModel(
                icon =
                    when (button.icon) {
                        IconButtonIcon.Eye -> PressableIconModel.Icon.EYE
                        IconButtonIcon.EyeOff -> PressableIconModel.Icon.EYE_OFF
                    },
                accessibilityLabel = button.accessibilityLabel,
                accessibilityHint = button.accessibilityHint,
                // The document models the press itself, so both edges are
                // declared events; reporting an interaction here as well
                // would double-count.
                onPressStart = { button.emitPressStart() },
                onPressEnd = { button.emitPressEnd() },
            ),
        )
    }
}

internal object IconRenderer : MilanoRenderer {
    @Composable
    override fun Render(node: MilanoNode) {
        val icon = IconNode(node)
        if (icon.visible == false) return
        IconView(IconModel(icon))
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
        val column = ColumnNode(node)
        ColumnContainer(
            padding = (column.padding ?: 16).toInt(),
            fillsWidth = column.width != ColumnWidth.Content,
        ) {
            for (child in node.children) {
                key(child.key) { child.Render() }
            }
        }
    }
}
