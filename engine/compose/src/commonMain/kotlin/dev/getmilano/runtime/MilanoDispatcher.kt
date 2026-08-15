package dev.getmilano

/**
 * The serialization seam: everything that touches a view's state runs
 * through its dispatcher, one item at a time. The platform layer binds it
 * to the main thread; the conformance harness injects a pump.
 */
fun interface MilanoDispatcher {
    fun dispatch(work: () -> Unit)
}

/**
 * The common-code default: runs inline, serialized by the caller's thread.
 * The Android source set supplies MilanoMainDispatcher, bound to the main
 * thread; this default suits single-threaded hosts and tests.
 */
object MilanoInlineDispatcher : MilanoDispatcher {
    override fun dispatch(work: () -> Unit) = work()
}
