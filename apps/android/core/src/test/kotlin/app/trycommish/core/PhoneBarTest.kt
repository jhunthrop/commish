package app.trycommish.core

import app.trycommish.api.models.LeaguePhase
import app.trycommish.core.leaguehome.LeagueChoice
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

/** The bottom bar is the web's phone five for the league's phase (rail-order.ts railFor), generated
 * into Rail.generated.kt: these lists are what the web draws at 390 px. */
class PhoneBarTest {
    private fun labels(
        phase: LeaguePhase,
        waiversOpen: Boolean,
    ) = phoneBar(LeagueChoice.Chosen("id", phase, waiversOpen)).map { it.label }

    @Test
    fun `in season the bar is the league's five pages`() {
        assertEquals(listOf("League", "Lineup", "Matchup", "Waivers", "Trades"), labels(LeaguePhase.in_season, waiversOpen = true))
    }

    @Test
    fun `in the playoffs Waivers drops once the wire closes`() {
        assertEquals(listOf("League", "Lineup", "Matchup", "Waivers", "Trades"), labels(LeaguePhase.playoffs, waiversOpen = true))
        assertEquals(listOf("League", "Lineup", "Matchup", "Trades", "Players"), labels(LeaguePhase.playoffs, waiversOpen = false))
    }

    @Test
    fun `before the draft the bar is the draft's five`() {
        assertEquals(listOf("Board", "Players", "Mock draft", "Cheat sheet", "Advisor"), labels(LeaguePhase.pre_draft, waiversOpen = false))
    }

    @Test
    fun `with no league, or a phase this build does not know, the season's bar without a league`() {
        val without = listOf("League", "Rest of season", "Players", "Mock draft", "Our record")
        assertEquals(without, phoneBar(null).map { it.label })
        assertEquals(without, phoneBar(LeagueChoice.NoLeague).map { it.label })
        assertEquals(without, labels(LeaguePhase.unknown_default_open_api, waiversOpen = false))
    }
}
