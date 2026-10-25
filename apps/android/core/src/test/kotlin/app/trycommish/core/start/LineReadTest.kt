package app.trycommish.core.start

import app.trycommish.api.decodeEnvelope
import app.trycommish.api.models.GameStateCell
import app.trycommish.api.models.LineupAdvice
import app.trycommish.api.models.PlayerLine
import app.trycommish.core.leaguehome.Fixtures
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.time.Instant

/** A line's game read from the API's field, never computed (spec §5.1): the field's state, a saved
 * not_started turning at kickoff, a bye as no game, and a line without the field or with a state this
 * build does not know held, so it never offers a move. */
class LineReadTest {
    private val before = Instant.parse("2026-10-18T16:59:00Z")
    private val after = Instant.parse("2026-10-18T17:00:00Z")

    private fun line(
        state: GameStateCell.State?,
        word: String = "",
    ): PlayerLine {
        val first = StartFixtures.lineup(StartFixtures.WEEK).slots[0].ours
        return first.copy(
            facts = first.facts.copy(kickoff = "2026-10-18T17:00:00Z"),
            gameState = state?.let { GameStateCell(it, word) },
        )
    }

    @Test
    fun `the field's state is read`() {
        assertEquals(GameRead.KickedOff, LineRead.game(line(GameStateCell.State.kicked_off, "Kicked off"), before))
        assertEquals(GameRead.Final, LineRead.game(line(GameStateCell.State.final, "Final"), before))
        assertEquals(GameRead.NoGame, LineRead.game(line(GameStateCell.State.bye, "Bye"), before))
        assertEquals(GameRead.NoGame, LineRead.game(line(GameStateCell.State.no_game), before))
    }

    @Test
    fun `a saved not_started turns at its kickoff`() {
        val line = line(GameStateCell.State.not_started, "Next kickoff")
        assertEquals(GameRead.Upcoming, LineRead.game(line, before))
        assertEquals(GameRead.KickedOff, LineRead.game(line, after))
        assertEquals("Kicked off", LineRead.word(line, GameRead.KickedOff, "Kicked off"))
    }

    @Test
    fun `a line without the field is held and never offers a move`() {
        val read = LineRead.game(line(null), before)
        assertEquals(GameRead.Unread(null), read)
        assertTrue(read.locked)
        assertFalse(read.toPlay)
    }

    @Test
    fun `a state this build does not know says its word and is held`() {
        val body =
            StartFixtures
                .lineupBody(StartFixtures.WEEK)
                .replaceFirst(
                    Regex("\"state\":\\s*\"[a-z_]+\",\\s*\"word\":\\s*\"[^\"]*\""),
                    "\"state\": \"suspended_for_weather\", \"word\": \"Delayed\"",
                )
        val line = decodeEnvelope<LineupAdvice>(body).slots[0].ours
        val read = LineRead.game(line, before)
        assertEquals(GameRead.Unread("Delayed"), read)
        assertTrue(read.locked)
        val row = StartRows.row(line, "QB", Fixtures.zone, before)
        assertEquals(RowGame.Game("vs LAC", "Delayed"), row.game)
    }
}
