package dev.getmilano.sample.desktop.designsystem

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Box
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.toComposeImageBitmap
import androidx.compose.ui.layout.ContentScale
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.jetbrains.skia.Image
import java.net.URI

/**
 * An image fetched from a URL, the desktop stand-in for an image loading
 * library: fetched off the UI thread once per URL, drawn when it arrives,
 * and the space kept meanwhile. Pure UI: knows nothing about Milano.
 */
@Composable
fun RemoteImage(
    url: String?,
    contentDescription: String?,
    contentScale: ContentScale,
    modifier: Modifier = Modifier,
) {
    var bitmap by remember(url) { mutableStateOf<ImageBitmap?>(null) }
    LaunchedEffect(url) {
        if (url == null) return@LaunchedEffect
        bitmap =
            withContext(Dispatchers.IO) {
                runCatching { Image.makeFromEncoded(URI(url).toURL().readBytes()).toComposeImageBitmap() }.getOrNull()
            }
    }
    val image = bitmap
    if (image != null) {
        Image(bitmap = image, contentDescription = contentDescription, contentScale = contentScale, modifier = modifier)
    } else {
        Box(modifier = modifier)
    }
}
