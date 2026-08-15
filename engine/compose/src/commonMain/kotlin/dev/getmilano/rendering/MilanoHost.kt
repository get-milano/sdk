package dev.getmilano

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue

/**
 * The hosting container, for hosts that want the swap managed for them:
 * presents the loading content immediately, awaits the build, replaces it
 * with the MilanoView's content on success or the failure content on
 * failure. Building starts once per composition lifetime; recompose a new
 * MilanoHost to retry.
 */
@Composable
fun MilanoHost(
    builder: MilanoViewBuilder,
    loading: @Composable () -> Unit = {},
    failure: @Composable (Throwable) -> Unit = {},
) {
    var view by remember { mutableStateOf<MilanoView?>(null) }
    var error by remember { mutableStateOf<Throwable?>(null) }

    LaunchedEffect(Unit) {
        try {
            view = builder.build()
        } catch (t: Throwable) {
            error = t
        }
    }

    val builtView = view
    val buildError = error
    when {
        builtView != null -> builtView.Content()
        buildError != null -> failure(buildError)
        else -> loading()
    }
}
