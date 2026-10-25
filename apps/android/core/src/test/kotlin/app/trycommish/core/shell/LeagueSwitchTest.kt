package app.trycommish.core.shell

import app.trycommish.api.models.LeagueHost
import app.trycommish.api.models.LeaguePhase
import app.trycommish.api.models.ScoringPreset
import app.trycommish.core.AppWords
import app.trycommish.core.leaguehome.Fixtures
import app.trycommish.core.phoneBar
import app.trycommish.design.Words
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.time.Instant
import java.time.ZoneId

/** The league switch names each league and its phase exactly as the web's menu does
 * (shared/fixtures/parity/shell.json, from menu-words.ts phaseWords and leagueLine and names.ts
 * followedName), lists every followed league in GET /me's order with the selected one marked in place,
 * and says what to do with none. */
class LeagueSwitchTest {
    private val parity = ShellFixtures.parity
    private val zone = ZoneId.of(parity.zone)

    @Test
    fun `every platform, scoring and board line is the web's`() {
        assertEquals(40, parity.lines.size)
        parity.lines.forEach { item ->
            val league =
                FollowedLeague("l", "L", item.host, item.scoring, item.format, LeaguePhase.in_season, null, waiversOpen = true)
            assertEquals(item.line, leagueLine(league), "${item.host} ${item.scoring} ${item.format}")
        }
    }

    @Test
    fun `a scoring this build does not know leaves the platform alone`() {
        val league = FollowedLeague("l", "L", LeagueHost.espn, null, null, LeaguePhase.in_season, null, waiversOpen = true)
        assertEquals("ESPN", leagueLine(league))
    }

    @Test
    fun `every case's names and phase words are the web's`() {
        assertEquals(12, parity.cases.size)
        parity.cases.forEach { item ->
            val leagues = item.leagues.map { ShellFixtures.followed(it) }
            assertEquals(item.phases, phaseWords(leagues, Instant.parse(item.now), zone), "${item.set} ${item.now}")
            leagues.forEach { assertEquals(item.names[it.id], followedName(it), it.id) }
        }
    }

    @Test
    fun `the list keeps the API's order and marks the selected league in place`() {
        val leagues = ShellFixtures.three()
        val model = leagueSwitch(leagues, leagues[1].id, ShellFixtures.week, Fixtures.zone)
        assertEquals("Thursday Night Keepers", model.face)
        assertEquals(Words.Shell.yourLeagues, model.title)
        assertEquals(leagues.map { it.id }, model.rows.map { it.id })
        assertEquals(listOf(false, true, false), model.rows.map { it.selected })
        assertEquals(listOf("FFPC, PPR", "Sleeper, PPR", "Sleeper, PPR"), model.rows.map { it.line })
        assertEquals(listOf("Drafted", "Draft Wed 12:00 pm", "Playoffs"), model.rows.map { it.phase })
        assertNull(model.none)
    }

    @Test
    fun `leagues in one phase carry no phase word`() {
        val leagues = ShellFixtures.three().filter { it.phase == LeaguePhase.in_season }
        val model = leagueSwitch(leagues, leagues.first().id, ShellFixtures.week, Fixtures.zone)
        assertTrue(model.rows.all { it.phase == null })
    }

    @Test
    fun `no league followed says how to follow one`() {
        val model = leagueSwitch(emptyList(), null, ShellFixtures.week, Fixtures.zone)
        assertEquals(Words.LeagueSwitch.followFirst, model.face)
        assertTrue(model.rows.isEmpty())
        assertEquals(AppWords.followNone, model.none)
    }

    @Test
    fun `a phase this build does not know reads as drafted`() {
        assertEquals(
            phaseWord(LeaguePhase.in_season, null, ShellFixtures.week, zone),
            phaseWord(LeaguePhase.unknown_default_open_api, null, ShellFixtures.week, zone),
        )
    }

    /** B149: a bar with no League tab (before the draft) still reaches the League home, through the
     * switch; a bar with one opens it there. */
    @Test
    fun `choosing a league opens its home`() {
        val (season, preDraft) = ShellFixtures.three().let { it[0] to it[1] }
        assertEquals(ShellDestination.Push(ShellRoute.LeagueHome("l-1")), homeOf("l-1", phoneBar(preDraft, null)))
        assertEquals(ShellDestination.Tab(LEAGUE_PAGE), homeOf("l-1", phoneBar(season, null)))
    }

    /** The League home's Open Lineup opens the Lineup tab for the league the tabs show; a home pushed for
     * another league, or under a bar with no Lineup, goes to the site. */
    @Test
    fun `open lineup opens the Lineup tab for the league shown`() {
        val (season, preDraft) = ShellFixtures.three().let { it[0] to it[1] }
        assertEquals(ShellDestination.Tab(LINEUP_PAGE), lineupOf(season.id, season.id, phoneBar(season, null)))
        assertNull(lineupOf("another", season.id, phoneBar(season, null)))
        assertNull(lineupOf(preDraft.id, preDraft.id, phoneBar(preDraft, null)))
    }

    @Test
    fun `the search opens Players with what was typed, and nothing for nothing`() {
        assertEquals(ShellRoute.Players("puka"), searchRoute("  puka "))
        assertNull(searchRoute("   "))
    }

    @Test
    fun `TE premium reads in the switch's own words`() {
        val league = ShellFixtures.three()[0].copy(scoring = ScoringPreset.te_premium)
        assertEquals("FFPC, ${Words.LeagueSwitch.tePremium}", leagueLine(league))
    }
}
