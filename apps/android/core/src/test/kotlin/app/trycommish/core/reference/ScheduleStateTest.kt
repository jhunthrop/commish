package app.trycommish.core.reference

import app.trycommish.api.models.RunGame
import app.trycommish.api.models.RunGameState
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test
import java.time.ZoneId

/** The current week's states as schedule-state.ts says them (Lane 223, B187), at fixed instants in a
 * fixed zone: the run's state, never the clock's. */
class ScheduleStateTest {
    private val zone = ZoneId.of("America/Chicago")
    private val readAt = "2026-10-25T05:00:00Z"

    /** Sunday Oct 25, noon Central. */
    private val sundayNoon = "2026-10-25T17:00:00Z"

    private fun game(
        week: Int,
        state: RunGameState?,
        kickoff: String = sundayNoon,
    ) = RunGame(week = week, opponent = "DEN", home = true, kickoff = kickoff, state = state)

    private val season = (1..18).map { game(it, RunGameState.upcoming) }

    @Test
    fun `the current week is the one after the last complete week while the season is underway`() {
        assertEquals(CurrentWeek(7, readAt), ScheduleState.currentWeek(season, Reach(6, null), underway = true, readAt))
        assertEquals(CurrentWeek(1, readAt), ScheduleState.currentWeek(season, Reach(0, null), underway = true, readAt))
    }

    @Test
    fun `no current week before the season, with a game unread, or after the last week`() {
        assertNull(ScheduleState.currentWeek(season, Reach(6, null), underway = false, readAt))
        // Week 7 holds two games, one of them with no state read.
        val unread = season.map { if (it.week == 7) it.copy(state = null) else it } + game(7, RunGameState.`final`)
        assertNull(ScheduleState.currentWeek(unread, Reach(6, null), underway = true, readAt))
        assertNull(ScheduleState.currentWeek(season, Reach(18, null), underway = true, readAt))
    }

    @Test
    fun `a game of the current week says Final, Kicked off or its kickoff with its day and zone`() {
        val current = CurrentWeek(7, readAt)
        assertEquals("Final", ScheduleState.word(game(7, RunGameState.`final`), current, zone))
        assertEquals("Kicked off", ScheduleState.word(game(7, RunGameState.kicked_off), current, zone))
        assertEquals("Sun 12:00 pm CT", ScheduleState.word(game(7, RunGameState.upcoming), current, zone))
    }

    @Test
    fun `nothing for a state this build does not know, an unread kickoff, another week or no current week`() {
        val current = CurrentWeek(7, readAt)
        assertNull(ScheduleState.word(game(7, RunGameState.unknown_default_open_api), current, zone))
        assertNull(ScheduleState.word(game(7, RunGameState.upcoming, kickoff = "not a time"), current, zone))
        assertNull(ScheduleState.word(game(8, RunGameState.`final`), current, zone))
        assertNull(ScheduleState.word(game(7, RunGameState.`final`), null, zone))
    }

    @Test
    fun `the as-of line names the run's read, and none for a read that does not parse`() {
        assertEquals(
            "Week 7's games as of Sun Oct 25, 12:00 am Central.",
            ScheduleState.asOf(CurrentWeek(7, readAt), zone),
        )
        assertNull(ScheduleState.asOf(CurrentWeek(7, "yesterday"), zone))
    }
}
