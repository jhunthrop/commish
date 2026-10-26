package app.trycommish.core.reference

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

/** Compare's Bye row as the web's compare-rows.ts draws it since Lane 223: a played bye is blank, an
 * unnamed one the empty figure, and the row goes only when both byes are played. */
class CompareByeRowTest {
    private fun cells(
        byes: Pair<Int?, Int?>,
        from: Int?,
    ): List<String>? =
        CompareRows
            .byeRow(byes, from)
            .singleOrNull()
            ?.cells
            ?.map { it.text }

    @Test
    fun `both ahead print their weeks`() = assertEquals(listOf("7", "11"), cells(7 to 11, 7))

    @Test
    fun `a played bye is blank beside one ahead`() = assertEquals(listOf("", "11"), cells(6 to 11, 7))

    @Test
    fun `an unnamed bye is the empty figure`() {
        assertEquals(listOf("--", "11"), cells(null to 11, 7))
        assertEquals(listOf("--", ""), cells(null to 6, 7))
        assertEquals(listOf("--", "--"), cells(null to null, 7))
    }

    @Test
    fun `the row goes only when both byes are played`() = assertEquals(null, cells(5 to 6, 7))

    @Test
    fun `a full season's board keeps every bye`() = assertEquals(listOf("5", "6"), cells(5 to 6, null))
}
