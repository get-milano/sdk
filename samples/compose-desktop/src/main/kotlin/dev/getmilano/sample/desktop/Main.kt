package dev.getmilano.sample.desktop

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.painter.BitmapPainter
import androidx.compose.ui.graphics.toComposeImageBitmap
import androidx.compose.ui.res.useResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Window
import androidx.compose.ui.window.application
import androidx.compose.ui.window.rememberWindowState
import dev.getmilano.sample.desktop.environment.SampleEnvironment
import dev.getmilano.sample.desktop.ui.SampleApp
import dev.getmilano.sample.desktop.ui.Screen
import org.jetbrains.skia.Image

/**
 * The desktop entry point: one window, the same demos as the iOS, Android,
 * and React Native samples, rendered from the same documents.
 *
 * Dev affordance: `--screen=banner|banner-card|banner-strip|form|...`
 * opens a demo directly (used for screenshot automation).
 */
fun main(args: Array<String>) {
    val initialScreen =
        Screen.fromKey(args.firstOrNull { it.startsWith("--screen=") }?.removePrefix("--screen="))
    val environment = SampleEnvironment()

    application {
        Window(
            onCloseRequest = ::exitApplication,
            title = "Milano",
            icon = BitmapPainter(useResource("app-icon.png") { Image.makeFromEncoded(it.readBytes()).toComposeImageBitmap() }),
            state = rememberWindowState(width = 480.dp, height = 860.dp),
        ) {
            MaterialTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    SampleApp(environment, initialScreen)
                }
            }
        }
    }
}
