package app.trycommish.design

import android.content.Context
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.unit.Dp
import coil3.ImageLoader
import coil3.compose.AsyncImagePainter
import coil3.compose.rememberAsyncImagePainter
import coil3.disk.DiskCache
import coil3.request.ImageRequest
import okio.Path.Companion.toOkioPath
import kotlin.math.ceil

/**
 * The image loader every face draws through, one for the process: Coil's memory cache and a disk cache
 * under the app's cache directory, so a face drawn once draws again with no signal.
 */
object Headshots {
    private const val DIRECTORY = "headshots"
    private const val DISK_BYTES = 32L * 1024 * 1024

    @Volatile
    private var shared: ImageLoader? = null

    fun loader(context: Context): ImageLoader =
        shared ?: synchronized(this) {
            shared ?: build(context.applicationContext).also { shared = it }
        }

    private fun build(context: Context): ImageLoader =
        ImageLoader
            .Builder(context)
            .diskCache {
                DiskCache
                    .Builder()
                    .directory(context.cacheDir.resolve(DIRECTORY).toOkioPath())
                    .maxSizeBytes(DISK_BYTES)
                    .build()
            }.build()
}

/**
 * A player's face (web Face.svelte, iOS Headshot): his headshot in a circle, his initials (Avatar) while
 * it loads, when it cannot (no signal and none cached) and where he has none. The circle is its side
 * whatever the image does, so a row never waits on it. A preview or a snapshot loads nothing and draws
 * the initials.
 */
@Composable
fun Headshot(
    url: String?,
    initials: String,
    side: Dp,
    modifier: Modifier = Modifier,
) {
    val address = url?.takeIf { it.isNotBlank() && !LocalInspectionMode.current }
    if (address == null) {
        Avatar(initials, side, modifier)
        return
    }
    val context = LocalContext.current
    val pixels = with(LocalDensity.current) { ceil(side.toPx()).toInt() }
    // Sized to the circle so it loads at once, without waiting for a draw to measure it.
    val request =
        remember(address, pixels) {
            ImageRequest
                .Builder(context)
                .data(address)
                .size(pixels)
                .build()
        }
    val painter = rememberAsyncImagePainter(request, imageLoader = Headshots.loader(context), contentScale = ContentScale.Crop)
    val state by painter.state.collectAsState()
    if (state is AsyncImagePainter.State.Success) {
        Box(modifier.size(side).clip(CircleShape).background(CommishTheme.colors.surface2)) {
            Image(painter, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
        }
    } else {
        Avatar(initials, side, modifier)
    }
}
