package dev.getmilano

/**
 * An asynchronous receiver of custom actions: one funnel per view.
 * Normal return is success; throwing is failure. Completion-exactly-once
 * holds by construction.
 */
fun interface MilanoActionHandler {
    suspend fun handle(action: MilanoAction)
}

/** A dispatched custom action, delivered as data. */
data class MilanoAction(
    val name: String,
    val parameters: Map<String, MilanoValue>,
    val viewIdentity: String,
)
