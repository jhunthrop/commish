package app.trycommish.core.matchup

import app.trycommish.api.decodeEnvelope
import app.trycommish.api.models.LeagueSync
import app.trycommish.api.models.MatchupBox
import app.trycommish.api.models.Scoreboard
import app.trycommish.core.leaguehome.Fixtures
import java.io.File

/** The shared fixture league's league read (GET /leagues/attached/{id}/sync) and box score (GET
 * /leagues/attached/{id}/matchup) at the six fixture clocks, as the API sends them (Lane 183's export),
 * and the web's Matchup at each (shared/fixtures/parity/matchup.json); and another team's game (Lane 206's
 * export: `?roster=2`, with the league read and the scoreboard as the Sleeper league reads them). */
object MatchupFixtures {
    /** Saturday noon, before the first kickoff. */
    const val BEFORE = "2026-10-17T17-00-00Z"

    /** Sunday 18:56Z: kicked off, still to come and final rows. */
    const val SUNDAY = "2026-10-18T18-56-00Z"

    /** Monday morning: Sunday's starters final, Monday night still to come. */
    const val MONDAY = "2026-10-19T16-00-00Z"

    /** Tuesday noon: every game final. */
    const val FINAL = "2026-10-20T17-00-00Z"

    private val inseason = File(System.getProperty("fixtures"), "inseason")

    fun syncBody(clock: String): String = File(inseason, "sync-${Fixtures.LEAGUE_ID}-$clock.json").readText()

    fun boxBody(clock: String): String = File(inseason, "matchup-${Fixtures.LEAGUE_ID}-$clock.json").readText()

    fun sync(clock: String): LeagueSync = decodeEnvelope(syncBody(clock))

    fun box(clock: String): MatchupBox = decodeEnvelope(boxBody(clock))

    /** The roster whose game the fixture exports as another team's: Carried by QJs against Bower Rangers. */
    const val OTHER_ROSTER = 2

    fun otherSyncBody(clock: String): String = File(inseason, "sync-${Fixtures.LEAGUE_ID}-sleeper-$clock.json").readText()

    fun otherBoxBody(clock: String): String = File(inseason, "matchup-${Fixtures.LEAGUE_ID}-roster-$OTHER_ROSTER-$clock.json").readText()

    fun otherBoardBody(clock: String): String = File(inseason, "scoreboard-${Fixtures.LEAGUE_ID}-sleeper-$clock.json").readText()

    fun otherSync(clock: String): LeagueSync = decodeEnvelope(otherSyncBody(clock))

    fun otherBox(clock: String): MatchupBox = decodeEnvelope(otherBoxBody(clock))

    fun otherBoard(clock: String): Scoreboard = decodeEnvelope(otherBoardBody(clock))

    fun parity(): String = File(System.getProperty("fixtures"), "parity/matchup.json").readText()
}
