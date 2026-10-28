package app.trycommish.feature.sheet

import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File

/** Every committed reference is small enough to keep in the repository. */
class SheetReferencesTest {
    @Test
    fun everyReferenceIsSmallEnoughToKeep() {
        val images = File("src/test/snapshots/images").listFiles().orEmpty()
        assertEquals(emptyList<String>(), images.filter { it.length() > MAX_BYTES }.map { it.name })
    }

    private companion object {
        const val MAX_BYTES = 300 * 1024
    }
}
