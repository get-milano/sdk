package dev.getmilano

/**
 * An asynchronous receiver of custom actions: one funnel per view.
 * Normal return is success and the returned value, validated against the
 * action's declared result type, binds the result root inside onSuccess;
 * return null for actions declaring no result. Throwing is failure.
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
)
