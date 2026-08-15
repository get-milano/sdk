package dev.getmilano

/**
 * Supplies and updates context values. Milano validates each change
 * atomically; an invalid update is rejected whole and reported.
 */
interface MilanoContextSource {
    val current: Map<String, MilanoValue>

    fun subscribe(onUpdate: (Map<String, MilanoValue>) -> Unit)
}

/**
 * The standard context source: create it with initial values, push updates
 * from any thread.
 */
class MilanoContextHandle(
    initial: Map<String, MilanoValue>,
) : MilanoContextSource {
    private var values: Map<String, MilanoValue> = initial
    private val subscribers = ArrayList<(Map<String, MilanoValue>) -> Unit>()

    override val current: Map<String, MilanoValue>
        @Synchronized get() = values

    @Synchronized
    override fun subscribe(onUpdate: (Map<String, MilanoValue>) -> Unit) {
        subscribers.add(onUpdate)
    }

    /**
     * Merges the given values over the current ones and notifies views.
     * May be called from any thread; validation and application happen on
     * each view's dispatcher.
     */
    fun update(newValues: Map<String, MilanoValue>) {
        val (snapshot, subs) = merge(newValues)
        for (subscriber in subs) subscriber(snapshot)
    }

    @Synchronized
    private fun merge(
        newValues: Map<String, MilanoValue>,
    ): Pair<Map<String, MilanoValue>, List<(Map<String, MilanoValue>) -> Unit>> {
        values = values + newValues
        return values to subscribers.toList()
    }
}

/** A fixed context source for hosts with nothing to update. */
internal class StaticContextSource(
    override val current: Map<String, MilanoValue>,
) : MilanoContextSource {
    override fun subscribe(onUpdate: (Map<String, MilanoValue>) -> Unit) {}
}
