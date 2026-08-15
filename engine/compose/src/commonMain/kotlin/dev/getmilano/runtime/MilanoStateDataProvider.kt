package dev.getmilano

/**
 * An asynchronous source of initial state values, awaited during building
 * and validated against the document's declarations. Provider errors
 * propagate to the build caller unchanged: they are host errors, not
 * Milano errors.
 */
fun interface MilanoStateDataProvider {
    suspend fun initialState(declarations: Map<String, MilanoType>): Map<String, MilanoValue>
}
