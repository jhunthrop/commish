package app.trycommish.design

import androidx.compose.ui.text.font.FontWeight
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import java.io.File

/** One place decides the display face's cut (NumWeight): the roles keep iOS's CSS numbers, and no
 * screen's source sets a weight on a display-face style or reaches for a variation of its own. */
class FaceWeightTest {
    private val android = File(System.getProperty("repository")).resolve("apps/android")

    @Test
    fun `the roles are iOS's CSS numbers and each draws heavier than it asks`() {
        assertEquals(listOf(500, 600, 700), NumWeight.entries.map { it.css })
        NumWeight.entries.forEach { assert(it.drawn >= it.css) { "${it.name} draws at ${it.drawn}, under its CSS ${it.css}" } }
    }

    @Test
    fun `the display face's styles take their role's drawn weight`() {
        assertEquals(FontWeight(NumWeight.SemiBold.drawn), Faces.cell.fontWeight)
        assertEquals(FontWeight(NumWeight.Bold.drawn), Faces.figure.fontWeight)
        assertEquals(FontWeight(NumWeight.Bold.drawn), Faces.head.fontWeight)
        assertEquals(FontWeight(NumWeight.Medium.drawn), Faces.number(NumWeight.Medium).fontWeight)
    }

    @Test
    fun `no screen picks a cut of the display face`() {
        val sources =
            android
                .walkTopDown()
                .filter { it.isFile && it.extension == "kt" && "/src/main/" in it.path && "/build/" !in it.path }
                .filter { it.name != "Faces.kt" }
                .toList()
        assert(sources.size > MIN_SOURCES) { "only ${sources.size} sources found under $android" }
        val found =
            sources.flatMap { file ->
                val text = file.readText()
                PICKS.filter { it.containsMatchIn(text) }.map { "${file.relativeTo(android)}: ${it.pattern}" }
            }
        assertEquals(emptyList<String>(), found)
    }

    private companion object {
        const val MIN_SOURCES = 50

        /** A display-face style copied with a weight, the heavy cut by name, or a variation outside Faces. */
        val PICKS =
            listOf(
                Regex("""Faces\.(cell|figure|head|number\([^)]*\))\.copy\((?:[^()]|\([^()]*\))*fontWeight"""),
                Regex("""FontWeight\.(ExtraBold|Black)"""),
                Regex("""FontVariation"""),
            )
    }
}
