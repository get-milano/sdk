package dev.getmilano

import javax.swing.SwingUtilities

/**
 * The desktop JVM's main thread is the AWT event dispatch thread, which is
 * also where Compose Desktop runs composition: the platform default keeps
 * the state and actions spec's main-thread guarantee there. Executes
 * inline when already on the EDT, mirroring the Android main-looper
 * dispatcher.
 */
internal actual fun platformDefaultDispatcher(): MilanoDispatcher = MilanoSwingDispatcher()

private class MilanoSwingDispatcher : MilanoDispatcher {
    override fun dispatch(work: () -> Unit) {
        if (SwingUtilities.isEventDispatchThread()) {
            work()
        } else {
            SwingUtilities.invokeLater(work)
        }
    }
}
