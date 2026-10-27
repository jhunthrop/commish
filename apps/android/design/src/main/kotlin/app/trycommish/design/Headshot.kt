package app.trycommish.design

import android.content.Context
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
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
 * Faces as the web serves them (web/src/lib/ui/headshot.ts): only a provider headshot is drawn, asked of
 * the site's image route at the web's widths, so the disk cache holds thumbnails and no other host is
 * ever asked; one image loader for the process with a disk cache under the app's cache directory, so a
 * face drawn once draws again with no signal.
 */
object Headshots {
    private const val DIRECTORY = "headshots"
    private const val DISK_BYTES = 16L * 1024 * 1024

    /** The image is drawn wider than the circle so the head fills it (headshot.ts FACE_OVERFILL). */
    const val OVERFILL = 1.4

    /** The widths the site's route serves (HEADSHOT_MIN_WIDTH, HEADSHOT_MAX_WIDTH). */
    const val MIN_WIDTH = 16
    const val MAX_WIDTH = 480

    private val provider = Regex("""^https://a\.espncdn\.com/i/headshots/([a-z-]+)/players/full/(\d+)\.png$""")
    private val leagues = setOf("nfl", "college-football")

    /** headshot.ts headshotAt: a provider headshot's address on the site at a width in pixels, null for
     * any other address, which draws the initials. */
    fun sized(
        url: String,
        width: Int,
    ): String? {
        val match = provider.matchEntire(url) ?: return null
        val (league, id) = match.destructured
        if (league !in leagues) return null
        return "${Site.ORIGIN}/img/headshots/$league/$id/${width.coerceIn(MIN_WIDTH, MAX_WIDTH)}"
    }

    /** headshot.ts headshotSources' widths: the face's side in dp overfilled at 1x, and twice that on any
     * denser screen, so every phone asks the route for one of the two widths the web asks for. */
    fun widthFor(
        sideDp: Float,
        density: Float,
    ): Int {
        val drawn = ceil(sideDp * OVERFILL).toInt()
        return if (density > 1f) drawn * 2 else drawn
    }

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

/** Waits for a network to start working and asks again each time; the watch is registered for as long
 * as this runs, and unregistered when the face that waits leaves the screen or loads. */
suspend fun retryOnWorkingNetwork(
    networks: WorkingNetworks,
    retry: () -> Unit,
) {
    networks.gained().collect { retry() }
}

/** The extra that makes a retried face a new request. */
private const val ATTEMPT = "attempt"

/**
 * A player's face (web Face.svelte, iOS Headshot): his headshot in a circle, his initials (Avatar) while
 * it loads, when it cannot (no signal and none cached) and where he has none or the address is not a
 * provider headshot. The circle is its side whatever the image does, so a row never waits on it. A face
 * that failed asks again when it is next drawn or a network starts working while it is on screen. A
 * preview or a snapshot loads nothing and draws the initials. A defense's face (`club`, B245) is its
 * club's chip, and no image is asked for: the app draws no team logo.
 */
@Composable
fun Headshot(
    url: String?,
    initials: String,
    side: Dp,
    modifier: Modifier = Modifier,
    club: String? = null,
) {
    if (club != null) {
        Avatar(initials, side, modifier, club = club)
        return
    }
    val density = LocalDensity.current
    val address =
        url
            ?.takeUnless { LocalInspectionMode.current }
            ?.let { Headshots.sized(it, Headshots.widthFor(side.value, density.density)) }
    if (address == null) {
        Avatar(initials, side, modifier)
        return
    }
    val context = LocalContext.current
    val pixels = with(density) { ceil(side.toPx()).toInt() }
    var attempt by remember(address) { mutableIntStateOf(0) }
    // Sized to the circle so it loads at once, without waiting for a draw to measure it.
    val request =
        remember(address, pixels, attempt) {
            ImageRequest
                .Builder(context)
                .data(address)
                .size(pixels)
                // A retry is a request of its own: Coil restarts only for a request unlike the last.
                .memoryCacheKeyExtra(ATTEMPT, attempt.toString())
                .build()
        }
    val painter = rememberAsyncImagePainter(request, imageLoader = Headshots.loader(context), contentScale = ContentScale.Crop)
    val state by painter.state.collectAsState()
    if (state is AsyncImagePainter.State.Error) {
        val networks = remember(context) { DeviceNetworks(context) }
        LaunchedEffect(networks, attempt) { retryOnWorkingNetwork(networks) { attempt += 1 } }
    }
    if (state is AsyncImagePainter.State.Success) {
        Box(modifier.size(side).clip(CircleShape).background(CommishTheme.colors.surface2)) {
            Image(painter, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
        }
    } else {
        Avatar(initials, side, modifier)
    }
}
