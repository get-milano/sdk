// Generated from vocabulary "examples" 1.1.0 by generate_bindings.py.
// Do not edit; regenerate when the vocabulary changes.
package dev.getmilano.sample.milanobridge

import dev.getmilano.MilanoAction
import dev.getmilano.MilanoEngine
import dev.getmilano.MilanoNode
import dev.getmilano.MilanoValue

/** Members of the `contentAlignment` enum on `Banner`. Gate-guaranteed: decoding never fails. */
enum class BannerContentAlignment(
    val value: String,
) {
    BottomLeading("bottomLeading"),
    BottomTrailing("bottomTrailing"),
    Center("center"),
    TopLeading("topLeading"),
    TopTrailing("topTrailing"),
    ;

    companion object {
        fun from(value: String): BannerContentAlignment = entries.first { it.value == value }
    }
}

/** Members of the `layout` enum on `Banner`. Gate-guaranteed: decoding never fails. */
enum class BannerLayout(
    val value: String,
) {
    Card("card"),
    Overlay("overlay"),
    Strip("strip"),
    ;

    companion object {
        fun from(value: String): BannerLayout = entries.first { it.value == value }
    }
}

/** Members of the `liveRegion` enum on `Text`. Gate-guaranteed: decoding never fails. */
enum class TextLiveRegion(
    val value: String,
) {
    Assertive("assertive"),
    Polite("polite"),
    ;

    companion object {
        fun from(value: String): TextLiveRegion = entries.first { it.value == value }
    }
}

/** Members of the `role` enum on `Text`. Gate-guaranteed: decoding never fails. */
enum class TextRole(
    val value: String,
) {
    Body("body"),
    Subtitle("subtitle"),
    Title("title"),
    ;

    companion object {
        fun from(value: String): TextRole = entries.first { it.value == value }
    }
}

/** Typed view of a resolved [Banner] node; non-null accessors are gate-guaranteed. */
class BannerNode(
    val node: MilanoNode,
) {
    val backgroundImageUrl: String? get() = node.property("backgroundImageUrl").stringOrNull

    val contentAlignment: BannerContentAlignment? get() =
        node.property("contentAlignment").stringOrNull?.let {
            BannerContentAlignment.from(it)
        }

    val cornerRadius: Long? get() = node.property("cornerRadius").intOrNull

    val height: Long? get() = node.property("height").intOrNull

    val layout: BannerLayout? get() =
        node.property("layout").stringOrNull?.let {
            BannerLayout.from(it)
        }

    val showScrim: Boolean? get() = node.property("showScrim").boolOrNull

    val visible: Boolean? get() = node.property("visible").boolOrNull
}

/** Typed view of a resolved [Button] node; non-null accessors are gate-guaranteed. */
class ButtonNode(
    val node: MilanoNode,
) {
    val enabled: Boolean get() = node.property("enabled").boolOrNull!!

    val label: String get() = node.property("label").stringOrNull!!

    val visible: Boolean? get() = node.property("visible").boolOrNull

    fun emitTap() = node.emit("tap")
}

/** Typed view of a resolved [Card] node; non-null accessors are gate-guaranteed. */
class CardNode(
    val node: MilanoNode,
) {
    val accessibilityHint: String? get() = node.property("accessibilityHint").stringOrNull

    val accessibilityLabel: String? get() = node.property("accessibilityLabel").stringOrNull

    val cornerRadius: Long? get() = node.property("cornerRadius").intOrNull

    val padding: Long? get() = node.property("padding").intOrNull

    fun emitTap() = node.emit("tap")
}

/** Typed view of a resolved [Checkbox] node; non-null accessors are gate-guaranteed. */
class CheckboxNode(
    val node: MilanoNode,
) {
    val checked: Boolean get() = node.property("checked").boolOrNull!!

    val label: String get() = node.property("label").stringOrNull!!

    val visible: Boolean? get() = node.property("visible").boolOrNull

    fun emitChange(payload: Boolean) = node.emit("change", MilanoValue.BoolValue(payload))
}

/** Typed view of a resolved [Column] node; non-null accessors are gate-guaranteed. */
class ColumnNode(
    val node: MilanoNode,
)

/** Typed view of a resolved [Image] node; non-null accessors are gate-guaranteed. */
class ImageNode(
    val node: MilanoNode,
) {
    val contentDescription: String? get() = node.property("contentDescription").stringOrNull

    val cornerRadius: Long? get() = node.property("cornerRadius").intOrNull

    val decorative: Boolean? get() = node.property("decorative").boolOrNull

    val height: Long? get() = node.property("height").intOrNull

    val url: String get() = node.property("url").stringOrNull!!

    val width: Long? get() = node.property("width").intOrNull
}

/** Typed view of a resolved [NumberField] node; non-null accessors are gate-guaranteed. */
class NumberFieldNode(
    val node: MilanoNode,
) {
    val label: String get() = node.property("label").stringOrNull!!

    val value: Double get() = node.property("value").doubleOrNull!!

    val visible: Boolean? get() = node.property("visible").boolOrNull

    fun emitChange(payload: Double) = node.emit("change", MilanoValue.DoubleValue(payload))
}

/** Typed view of a resolved [Row] node; non-null accessors are gate-guaranteed. */
class RowNode(
    val node: MilanoNode,
) {
    val spacing: Long? get() = node.property("spacing").intOrNull
}

/** Typed view of a resolved [Text] node; non-null accessors are gate-guaranteed. */
class TextNode(
    val node: MilanoNode,
) {
    val liveRegion: TextLiveRegion? get() =
        node.property("liveRegion").stringOrNull?.let {
            TextLiveRegion.from(it)
        }

    val role: TextRole? get() =
        node.property("role").stringOrNull?.let {
            TextRole.from(it)
        }

    val text: String get() = node.property("text").stringOrNull!!

    val visible: Boolean? get() = node.property("visible").boolOrNull
}

/** Typed view of a resolved [TextField] node; non-null accessors are gate-guaranteed. */
class TextFieldNode(
    val node: MilanoNode,
) {
    val error: String? get() = node.property("error").stringOrNull

    val label: String get() = node.property("label").stringOrNull!!

    val required: Boolean? get() = node.property("required").boolOrNull

    val value: String get() = node.property("value").stringOrNull!!

    val visible: Boolean? get() = node.property("visible").boolOrNull

    fun emitChange(payload: String) = node.emit("change", MilanoValue.StringValue(payload))
}

/** Every custom action this vocabulary declares, decoded from dispatch. */
sealed interface ExamplesAction {
    data object Dismiss : ExamplesAction

    data class OpenUrl(
        val url: String,
    ) : ExamplesAction

    /** The handler completes it with a `string` result, bound to `result` in onSuccess. */
    data class SubmitContact(
        val email: String,
        val name: String,
        val phone: String?,
        val surname: String,
    ) : ExamplesAction

    /** An action outside this vocabulary's declarations. */
    data class Unrecognized(
        val action: MilanoAction,
    ) : ExamplesAction

    companion object {
        fun from(action: MilanoAction): ExamplesAction =
            when (action.name) {
                "dismiss" -> {
                    Dismiss
                }

                "openUrl" -> {
                    OpenUrl(
                        url = action.parameters["url"]!!.stringOrNull!!,
                    )
                }

                "submitContact" -> {
                    SubmitContact(
                        email = action.parameters["email"]!!.stringOrNull!!,
                        name = action.parameters["name"]!!.stringOrNull!!,
                        phone = action.parameters["phone"]?.stringOrNull,
                        surname = action.parameters["surname"]!!.stringOrNull!!,
                    )
                }

                else -> {
                    Unrecognized(action)
                }
            }
    }
}

/** The vocabulary these bindings were generated from. */
object ExamplesVocabulary {
    const val NAME: String = "examples"
    const val VERSION: String = "1.1.0"

    /** Refuses to run against an engine holding a different vocabulary. */
    fun assertMatches(engine: MilanoEngine) {
        check(engine.vocabularyName == NAME && engine.vocabularyVersion == VERSION) {
            "bindings generated from $NAME@$VERSION, engine holds" +
                " ${engine.vocabularyName}@${engine.vocabularyVersion}"
        }
    }
}
