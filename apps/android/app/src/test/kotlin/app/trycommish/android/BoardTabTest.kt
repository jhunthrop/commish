package app.trycommish.android

import app.trycommish.design.Rail
import org.junit.Assert.assertEquals
import org.junit.Test

/** The board's page is reached as the web's rail reaches it: the Board item before the draft, the Rest
 * of season item in season with no league, and no board in a league's season bar. */
class BoardTabTest {
    @Test
    fun `the bar item that opens the board says its season`() {
        assertEquals(false, boardInSeason(Rail.byKey.getValue("pre_draft")))
        assertEquals(false, boardInSeason(Rail.withoutLeagueBySeason.getValue("preseason")))
        assertEquals(true, boardInSeason(Rail.withoutLeagueBySeason.getValue("in_season")))
        assertEquals(true, boardInSeason(Rail.withoutLeague))
        assertEquals(null, boardInSeason(Rail.byKey.getValue("in_season")))
    }
}
