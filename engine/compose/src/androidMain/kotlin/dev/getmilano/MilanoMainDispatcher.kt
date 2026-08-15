package dev.getmilano

import android.os.Handler
import android.os.Looper

/**
 * The Android main-thread dispatcher, per the threading contract. Runs
 * inline when already on the main thread, so renderer emissions are
 * processed synchronously in FIFO order.
 */
class MilanoMainDispatcher : MilanoDispatcher {
    private val handler = Handler(Looper.getMainLooper())

    override fun dispatch(work: () -> Unit) {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            work()
        } else {
            handler.post(work)
        }
    }
}
