package dev.getmilano

/**
 * Supplies and updates context values. Milano validates each change
 * atomically; an invalid update is rejected whole and reported.
 * [subscribe] returns a cancellation, invoked by the runtime at teardown
 * so a source never retains callbacks for views that are gone.
 */
interface MilanoContextSource {
    val current: Map<String, MilanoValue>

    fun subscribe(onUpdate: (Map<String, MilanoValue>) -> Unit): () -> Unit
}

/**
 * The standard context source: create it with initial values, push updates
 * from any thread.
 */
class MilanoContextHandle(
    initial: Map<String, MilanoValue>,
) : MilanoContextSource {
    private var values: Map<String, MilanoValue> = initial
    private val subscribers = LinkedHashMap<Int, (Map<String, MilanoValue>) -> Unit>()
    private var nextToken = 0

    override val current: Map<String, MilanoValue>
        @Synchronized get() = values

    override fun subscribe(onUpdate: (Map<String, MilanoValue>) -> Unit): () -> Unit {
        val token = register(onUpdate)
        return { unregister(token) }
    }

    @Synchronized
    private fun register(onUpdate: (Map<String, MilanoValue>) -> Unit): Int {
        val token = nextToken++
        subscribers[token] = onUpdate
        return token
    }

    @Synchronized
    private fun unregister(token: Int) {
        subscribers.remove(token)
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
        return values to subscribers.values.toList()
    }
}

/** A fixed context source for hosts with nothing to update. */
internal class StaticContextSource(
    override val current: Map<String, MilanoValue>,
) : MilanoContextSource {
    override fun subscribe(onUpdate: (Map<String, MilanoValue>) -> Unit): () -> Unit = {}
}
