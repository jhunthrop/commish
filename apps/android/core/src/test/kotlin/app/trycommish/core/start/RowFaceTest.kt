package app.trycommish.core.start

import app.trycommish.api.models.PlayerLine
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test
import java.time.Instant
import java.time.ZoneId

/** A row's face is his line's https headshot, carried to the sheet he opens; a defense draws its club
 * mark and an address the app does not load draws his initials. */
class RowFaceTest {
    private val now = Instant.parse("2026-10-18T16:00:00Z")
    private val zone = ZoneId.of("America/New_York")
    private val face = "https://a.espncdn.com/i/headshots/nfl/players/full/4426515.png"

    private fun line(headshot: String?): PlayerLine {
        val first = StartFixtures.lineup(StartFixtures.WEEK).slots[0].ours
        return first.copy(headshot = headshot)
    }

    @Test
    fun `a player's row carries his headshot to his sheet`() {
        val row = StartRows.row(line(face), "QB", zone, now)
        assertEquals(face, row.headshot)
    }

    @Test
    fun `no address, or one that is not https, draws his initials`() {
        assertNull(StartRows.row(line(null), "QB", zone, now).headshot)
        assertNull(StartRows.row(line("http://a.espncdn.com/x.png"), "QB", zone, now).headshot)
    }

    @Test
    fun `a defense draws its club mark, never a face`() {
        val base = line(face)
        val defense = base.copy(player = base.player.copy(position = "DEF", team = "HOU", name = "Texans D/ST"))
        assertNull(StartRows.row(defense, "D/ST", zone, now).headshot)
    }
}
