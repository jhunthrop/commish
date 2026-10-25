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
        assertEquals(listOf(625, 675, 750), NumWeight.entries.map { it.drawn })
        NumWeight.entries.forEach { assert(it.drawn >= it.css) { "${it.name} draws at ${it.drawn}, under its CSS ${it.css}" } }
    }

    @Test
    fun `the interface face answers every CSS weight a screen asks for, drawn heavier as iOS draws it`() {
        assertEquals(listOf(400, 500, 600, 700), UiWeight.entries.map { it.css })
        assertEquals(listOf(475, 575, 675, 775), UiWeight.entries.map { it.drawn })
        assertEquals(
            listOf(FontWeight.Normal, FontWeight.Medium, FontWeight.SemiBold, FontWeight.Bold).map { it.weight },
            UiWeight.entries.map { it.css },
        )
        UiWeight.entries.forEach { assert(it.drawn > it.css) { "${it.name} draws at ${it.drawn}, not over its CSS ${it.css}" } }
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
                Regex("""FontWeight\(\d"""),
            )
    }
}
