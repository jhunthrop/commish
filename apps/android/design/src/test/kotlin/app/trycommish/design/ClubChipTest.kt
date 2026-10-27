package app.trycommish.design

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test
import java.io.File

/** A club is drawn as its chip, never a team logo (B245): the colours come from the shared table, every
 * club holds its letters at 4.5:1, no source of the app builds or names a logo address, and the face's
 * address helper never turns a club mark into a URL. */
class ClubChipTest {
    private val repository = requireNotNull(System.getProperty("repository")) { "the build sets the repository property" }
    private val android = File(repository).resolve("apps/android")

    @Test
    fun `the table names all 32 clubs, and each chip's letters hold 4,5 to 1 on its fill`() {
        assertEquals(CLUBS, Tokens.Club.colors.size)
        val weak =
            Tokens.Club.colors
                .filter { (_, chip) -> contrast(chip.fill, chip.ink) < MIN_CONTRAST }
                .keys
        assertEquals(emptySet<String>(), weak)
        assertEquals(ClubColor(0xFF03202F, 0xFFFFFFFF), Tokens.Club.colors["HOU"])
    }

    @Test
    fun `a club mark is never an address the face would load`() {
        LOGOS.forEach { assertNull(Headshots.sized(it, Headshots.MIN_WIDTH), it) }
    }

    @Test
    fun `no source of the app builds or names a team logo's address`() {
        val sources =
            android
                .walkTopDown()
                .filter { it.isFile && it.extension in setOf("kt", "kts", "xml") && "/build/" !in it.path }
                .filter { it.name != "ClubChipTest.kt" }
                .toList()
        assert(sources.size > MIN_SOURCES) { "only ${sources.size} sources found under $android" }
        val found =
            sources.flatMap { file ->
                val text = file.readText()
                MARKS.filter { it.containsMatchIn(text) }.map { "${file.relativeTo(android)}: ${it.pattern}" }
            }
        assertEquals(emptyList<String>(), found)
    }

    private fun luminance(argb: Long): Double {
        val channels = listOf(16, 8, 0).map { shift -> ((argb shr shift) and 0xFF) / 255.0 }
        val linear = channels.map { c -> if (c <= 0.03928) c / 12.92 else Math.pow((c + 0.055) / 1.055, 2.4) }
        return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
    }

    private fun contrast(
        a: Long,
        b: Long,
    ): Double {
        val (x, y) = luminance(a) to luminance(b)
        return (maxOf(x, y) + 0.05) / (minOf(x, y) + 0.05)
    }

    private companion object {
        const val CLUBS = 32
        const val MIN_CONTRAST = 4.5
        const val MIN_SOURCES = 50

        /** The marks' addresses the web builds (web/src/lib/ui/club-mark.ts, headshot-provider.ts). */
        val LOGOS =
            listOf(
                "https://a.espncdn.com/i/teamlogos/nfl/500/hou.png",
                "https://trycommish.app/img/clubs/nfl/hou/64",
            )

        /** A logo host path, the site's club image route, or a builder named for the mark. */
        val MARKS = listOf(Regex("teamlogos"), Regex("/img/clubs"), Regex("""clubMarkUrl|upstreamClubMark|fun clubMark\("""))
    }
}
