package app.trycommish.core.board

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/** A bye as the web's format/bye.ts says it (Lane 223, B190): a played bye draws nothing. */
class ByesTest {
    @Test
    fun `a bye ahead prints its week, a played one nothing, an unnamed one the empty figure`() {
        assertEquals("11", Byes.cell(11, 7))
        assertEquals("7", Byes.cell(7, 7))
        assertEquals("", Byes.cell(5, 7))
        assertEquals("--", Byes.cell(null, 7))
        assertEquals("5", Byes.cell(5, null))
    }

    @Test
    fun `a phone row says Bye week N while it is ahead and nothing after`() {
        assertEquals("Bye week 11", Byes.line(11, 7))
        assertNull(Byes.line(6, 7))
        assertNull(Byes.line(null, 7))
        assertEquals("Bye week 6", Byes.line(6, null))
    }

    @Test
    fun `played is a named bye before the week the board ranks from`() {
        assertTrue(Byes.played(6, 7))
        assertFalse(Byes.played(7, 7))
        assertFalse(Byes.played(null, 7))
        assertFalse(Byes.played(6, null))
    }
}
