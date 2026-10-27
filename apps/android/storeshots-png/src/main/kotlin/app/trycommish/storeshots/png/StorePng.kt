package app.trycommish.storeshots.png

import app.cash.paparazzi.Snapshot
import app.cash.paparazzi.SnapshotHandler
import java.awt.Color
import java.awt.image.BufferedImage
import java.io.File
import javax.imageio.ImageIO

/**
 * Writes each Paparazzi snapshot as `<name>.png` in `dir`: 24-bit RGB with no alpha channel, laid on
 * black first so nothing translucent survives. A frame of any other size than `width` by `height` fails.
 */
class OpaquePng(
    private val dir: File,
    private val width: Int,
    private val height: Int,
) : SnapshotHandler {
    override fun newFrameHandler(
        snapshot: Snapshot,
        frameCount: Int,
        fps: Int,
    ): SnapshotHandler.FrameHandler =
        object : SnapshotHandler.FrameHandler {
            override fun handle(image: BufferedImage) {
                check(image.width == width && image.height == height) {
                    "${snapshot.name} drew ${image.width} x ${image.height}, the store takes $width x $height"
                }
                write(opaque(image), File(dir, "${snapshot.name}.png"))
            }

            override fun close() = Unit
        }

    override fun close() = Unit
}

/** `source`, pixel for pixel, re-saved at `target` as a 32-bit PNG with an alpha channel. */
fun withAlpha(
    source: File,
    target: File,
    side: Int,
) {
    val image = requireNotNull(ImageIO.read(source)) { "$source is no image" }
    check(image.width == side && image.height == side) { "$source is ${image.width} x ${image.height}, not $side x $side" }
    val argb = BufferedImage(side, side, BufferedImage.TYPE_INT_ARGB)
    argb.createGraphics().apply {
        drawImage(image, 0, 0, null)
        dispose()
    }
    write(argb, target)
}

private fun opaque(image: BufferedImage): BufferedImage {
    val flat = BufferedImage(image.width, image.height, BufferedImage.TYPE_INT_RGB)
    flat.createGraphics().apply {
        color = Color.BLACK
        fillRect(0, 0, image.width, image.height)
        drawImage(image, 0, 0, null)
        dispose()
    }
    return flat
}

private fun write(
    image: BufferedImage,
    target: File,
) {
    target.parentFile.mkdirs()
    check(ImageIO.write(image, "png", target)) { "no PNG writer for $target" }
}
