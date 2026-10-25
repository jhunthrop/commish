package app.trycommish.core.matchup

import app.trycommish.api.models.GameStateCell
import app.trycommish.api.models.LeagueSync
import app.trycommish.api.models.MatchupBox
import app.trycommish.core.leaguehome.Fixtures
import app.trycommish.core.start.GameRead
import app.trycommish.core.start.RowGame
import app.trycommish.core.start.StartFixtures
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/**
 * The Matchup at the three Sunday fixture clocks and after Sunday, read through the model: the screen
 * stays on the platform's week until the platform turns (Monday waits on Monday night, Tuesday is
 * Final), and every line's state is the API's field, never its kickoff.
 */
class MatchupModelTest {
    private fun week(
        clock: String,
        sync: LeagueSync = MatchupFixtures.sync(clock),
        box: MatchupBox? = MatchupFixtures.box(clock),
    ): MatchupWeek {
        val model = matchupModel(sync, box, StartFixtures.instant(clock), Fixtures.zone)
        return (model as? MatchupModel.Week)?.week ?: error("no week at $clock")
    }

    @Test
    fun `before the first kickoff each side shows its Proj and the first kickoff`() {
        val bug = week(MatchupFixtures.BEFORE).bug
        assertEquals("First kickoff", bug.head)
        assertEquals("Proj", bug.mine.bigLabel)
        assertEquals("74.7", bug.mine.big)
        assertNull(bug.read)
    }

    @Test
    fun `on Sunday afternoon the live score reads with its read and who is left`() {
        val week = week(MatchupFixtures.SUNDAY)
        assertEquals("Next kickoff", week.bug.head)
        assertEquals("Sun 3:05 pm, ARI at LAR", week.bug.words)
        assertEquals("39.1", week.bug.mine.big)
        assertEquals("Proj final 73.2", week.bug.mine.small)
        assertEquals("3 to play", week.bug.mine.toPlay)
        assertEquals("FFPC 4 min ago", week.bug.read)
        val states =
            week.boxes
                .first()
                .starters
                .map { it.row.read }
                .toSet()
        assertTrue(GameRead.KickedOff in states && GameRead.Upcoming in states, "$states")
    }

    @Test
    fun `after Sunday the member waits on Monday night`() {
        val bug = week(MatchupFixtures.MONDAY).bug
        assertEquals("Week 6", bug.week)
        assertEquals("Next kickoff", bug.head)
        assertEquals("Mon 7:15 pm, WAS at SF", bug.words)
        assertEquals("1 to play", bug.mine.toPlay)
    }

    @Test
    fun `once every game is final the week is done`() {
        val week = week(MatchupFixtures.FINAL)
        assertEquals("Final", week.bug.head)
        assertNull(week.bug.read)
        assertEquals("Final 63.5", week.bug.mine.small)
        assertEquals(listOf("Final", "Final"), week.boxes.map { it.teamRow.caption })
    }

    @Test
    fun `a line's state is its field, never its kickoff`() {
        val box = MatchupFixtures.box(MatchupFixtures.BEFORE)
        val mine = box.sides.first()
        val first = mine.starters.first()
        val final = first.copy(line = first.line.copy(gameState = GameStateCell(GameStateCell.State.final, "Final")))
        val changed = box.copy(sides = listOf(mine.copy(starters = listOf(final) + mine.starters.drop(1))) + box.sides.drop(1))
        val row =
            week(MatchupFixtures.BEFORE, box = changed)
                .boxes
                .first()
                .starters
                .first()
        assertEquals(GameRead.Final, row.row.read)
        assertEquals("Final", (row.game as RowGame.Game).time)
    }

    @Test
    fun `every row with a page opens the sheet by his id`() {
        val week = week(MatchupFixtures.SUNDAY)
        val rows = week.boxes.flatMap { it.starters + it.bench }
        assertEquals(rows.count { it.row.slug != null }, week.sheetPlayers.size)
        assertTrue(week.sheetPlayers.all { player -> rows.any { it.id == player.id } })
    }
}
