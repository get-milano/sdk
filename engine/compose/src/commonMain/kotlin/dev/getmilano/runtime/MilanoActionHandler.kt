package dev.getmilano

/**
 * An asynchronous receiver of custom actions: one funnel per view.
 * Normal return is success and the returned value, validated against the
 * action's declared result type, binds the result root inside onSuccess;
 * return null for actions declaring no result. Throwing is failure: a
 * [MilanoActionFailure] carries the failure payload, validated against the
 * declared failure type and bound to the failure root inside onFailure;
 * any other exception is a failure with no payload.
 * Completion-exactly-once holds by construction.
 */
fun interface MilanoActionHandler {
    suspend fun handle(action: MilanoAction): MilanoValue?
}

/** A dispatched custom action, delivered as data. */
data class MilanoAction(
    val name: String,
    val parameters: Map<String, MilanoValue>,
    val viewIdentity: String,
    /**
     * The dispatch's position among the view's custom action dispatches,
     * counting from zero in delivery order (state and actions spec,
     * Dispatch identity). Deterministic; the conformance suite pins it.
     */
    val dispatch: Int = 0,
    /**
     * A string unique among every dispatch of every view in the process,
     * whatever the views' labels; its format is opaque. The host's
     * idempotency key toward whatever the handler calls.
     */
    val dispatchId: String = "",
)

/**
 * The exception a handler throws to fail a dispatch with a payload: the
 * value is validated against the action's declared failure type and bound
 * to the failure root inside onFailure. Any other exception is a failure
 * with no payload.
 */
class MilanoActionFailure(
    val value: MilanoValue? = null,
    message: String = "action failed",
) : Exception(message)
