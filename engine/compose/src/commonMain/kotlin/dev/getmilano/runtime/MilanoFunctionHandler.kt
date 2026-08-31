package dev.getmilano

/**
 * A host function call (expression spec, Host functions): the declared
 * function's name and its evaluated arguments, in declared order, each
 * already of its declared type.
 */
data class MilanoFunctionCall(
    val name: String,
    val arguments: List<MilanoValue>,
)

/**
 * The engine's synchronous resolver of host functions (contract 2.1), one
 * for every view and every surface's declarations. Invoked on the thread
 * evaluating the expression, during resolution and action evaluation: it
 * must be fast, must not block, must not touch the view, and must be pure
 * over its arguments (vocabulary schema spec, Function declarations). The
 * value is validated against the declared `returns`; a mismatch or a
 * thrown exception is an invalid function result, reported and replaced
 * by the zero value of the return type. Returning null is the null value.
 */
fun interface MilanoFunctionHandler {
    fun call(call: MilanoFunctionCall): MilanoValue?
}
