package app.trycommish.core.leaguehome

import app.trycommish.design.Words
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.time.Instant

/** The League home read from the shared fixture at the fixture's clocks. Every expected word and figure
 * is the web's (web/src/lib/league/home/home.ts) for the same answer at the same clock in the same zone,
 * so the app and the web print the same page. */
class LeagueHomeModelTest {
    private fun model(clock: Instant) = leagueHomeModel(Fixtures.sync(), Fixtures.scoreboard(clock), clock, Fixtures.zone)

    @Test
    fun `the head names the league, its platform and the week in the web's words`() {
        val home = model(Fixtures.sunday)
        assertEquals("S.U.C.K. - Severely Underrated Carolina Keepers", home.name)
        assertEquals("FFPC", home.platform)
        assertEquals("${Words.LeagueHome.week} 6", home.week)
    }

    @Test
    fun `before the first kickoff a game shows its Proj and the next kickoff`() {
        val game = model(Fixtures.week).games.first()
        assertEquals(GameState.Upcoming, game.state)
        assertEquals("Sun 8:30 am", game.head)
        assertEquals(Words.LeagueHome.nextKickoff, game.words)
        assertEquals("", game.smallHead)
        assertEquals(LeagueHomeWords.proj, game.bigHead)
        assertEquals(listOf("74.7", "104.8"), game.sides.map { it.big })
        assertEquals(listOf(Stands.Level, Stands.Level), game.sides.map { it.stands })
    }

    @Test
    fun `on Sunday a game under way shows Pts, Proj final, the read and who is ahead`() {
        val games = model(Fixtures.sunday).games
        val mine = games.first()
        assertTrue(mine.mine)
        assertEquals(GameState.KickedOff, mine.state)
        assertEquals(LeagueHomeWords.kickedOff, mine.head)
        assertEquals("FFPC 4 min ago", mine.words)
        assertEquals(LeagueHomeWords.projFinal, mine.smallHead)
        assertEquals(LeagueHomeWords.pts, mine.bigHead)
        val (me, them) = mine.sides
        assertEquals(
            listOf("McConkey Kong Country", "1-4", "39.1", "73.2", "3 to play"),
            listOf(me.name, me.record, me.big, me.small, me.toPlay),
        )
        assertTrue(me.me)
        assertEquals(Stands.Behind, me.stands)
        assertEquals(Stands.Ahead, them.stands)
        assertEquals("121.2", them.small)
        assertEquals(LeagueHomeWords.none, games[1].sides[0].small)
    }

    @Test
    fun `once every game is final a side's small figure is its total under the Final head`() {
        val game = model(Fixtures.tuesday).games[1]
        assertEquals(GameState.Final, game.state)
        assertEquals(Words.LeagueHome.final, game.head)
        assertEquals("", game.words)
        assertEquals(Words.LeagueHome.final, game.smallHead)
        assertEquals(listOf("23.8", "17.0"), game.sides.map { it.small })
        assertEquals(listOf("23.8", "17.0"), game.sides.map { it.big })
    }

    @Test
    fun `the standings keep the platform's order with each column as the web prints it`() {
        val standings = model(Fixtures.sunday).standings
        assertEquals(Words.LeagueHome.budget, standings.waiverHead)
        assertTrue(standings.projected)
        assertEquals(12, standings.rows.size)
        val first = standings.rows.first()
        assertEquals(
            listOf("1", "Muttdogs", "5-0-0", "818.2", "659.1", "W5", "$675", "34.1"),
            listOf(
                first.rank.toString(),
                first.name,
                first.record,
                first.pointsFor,
                first.pointsAgainst,
                first.streak,
                first.waiver,
                first.proj,
            ),
        )
        assertEquals(LeagueHomeWords.none, standings.rows[3].proj)
        val me = standings.rows.last()
        assertTrue(me.me)
        assertEquals(listOf("567.0", "730.3", "$1,000", "73.2"), listOf(me.pointsFor, me.pointsAgainst, me.waiver, me.proj))
        assertEquals(1, standings.rows.count { it.me })
    }

    @Test
    fun `the standings' basis is said once in the web's sentence`() {
        assertEquals(
            "Standings follow FFPC's record, then points for, as FFPC lists them. PF and PA are points for and " +
                "against, Streak the current run, FAAB the budget left of $1,000.",
            model(Fixtures.sunday).standings.basis,
        )
    }

    @Test
    fun `with no scoreboard the standings draw no Proj and the page no games`() {
        val home = leagueHomeModel(Fixtures.sync(), null, Fixtures.sunday, Fixtures.zone)
        assertTrue(home.games.isEmpty())
        assertFalse(home.standings.projected)
    }

    @Test
    fun `the lineup is the member's starters as the platform has them set, the bench as a count`() {
        val lineup = model(Fixtures.sunday).lineup
        assertEquals("McConkey Kong Country", lineup.team)
        assertEquals(10, lineup.starters.size)
        assertEquals(listOf("QB", "Aaron Rodgers", "PIT"), lineup.starters.first().let { listOf(it.position, it.name, it.club) })
        assertEquals(listOf("D/ST", "Minnesota Vikings"), lineup.starters.last().let { listOf(it.position, it.name) })
        assertEquals("${LeagueHomeWords.bench}, 10 players", lineup.bench)
    }

    @Test
    fun `the moves read newest first in the web's words`() {
        val moves = model(Fixtures.sunday).moves
        val rows = requireNotNull(moves).rows
        assertEquals(15, rows.size)
        val first = rows.first()
        assertEquals(listOf("Sun 11:44 am", LeagueHomeWords.freeAgent), listOf(first.whenText, first.kind))
        assertEquals(listOf("McConkey Kong Country"), first.teams)
        assertTrue(first.mine)
        assertEquals("Roschon Johnson", first.adds.single().name)
        assertEquals(listOf("RB", "CHI"), first.adds.single().let { listOf(it.position, it.club) })
        assertEquals("George Holani", first.drops.single().name)
        val waiver = rows.last()
        assertEquals(listOf("Wed 6:37 am", LeagueHomeWords.waiver, "FAAB $7"), listOf(waiver.whenText, waiver.kind, waiver.detail))
        assertEquals("D/ST", waiver.adds.single().position)
        val trade = rows.first { it.kind == LeagueHomeWords.trade }
        assertEquals(listOf("Dad Runners", "thatmattkelley"), trade.teams)
        assertEquals(listOf("Dad Runners", "thatmattkelley"), trade.adds.map { it.to })
        assertTrue(trade.drops.isEmpty())
        assertNull(moves.empty)
    }

    @Test
    fun `a league with no moves says so in the web's sentence`() {
        val quiet = Fixtures.sync().copy(moves = emptyList())
        val moves = requireNotNull(leagueHomeModel(quiet, null, Fixtures.sunday, Fixtures.zone).moves)
        assertTrue(moves.rows.isEmpty())
        assertEquals(Words.LeagueHome.noMoves, moves.empty)
    }

    @Test
    fun `a platform that gives no moves draws no feed`() {
        val unread = Fixtures.sync().copy(movesRead = false)
        assertNull(leagueHomeModel(unread, null, Fixtures.sunday, Fixtures.zone).moves)
    }
}
