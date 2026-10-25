package app.trycommish.core.matchup

import app.trycommish.api.Transport
import app.trycommish.api.bodyText
import java.util.UUID

/** The Matchup screen's reads (web MatchupScreen.svelte): the league read, whose matchup keeps the score
 * and the teams, the week's matchup as a box score, and for another team's game the scoreboard its score
 * is read from (Lane 207), each the envelope's body whole. A 401 throws [app.trycommish.api.Unauthorized]. */
interface MatchupReads {
    suspend fun sync(leagueId: String): String

    /** The box score of the member's game (`roster` null) or of the game `roster` plays in (Lane 204's
     * `?roster=`, a scoreboard side's roster); null where the API has none for the league
     * (MatchupScreen's STANDS_WITHOUT: 404, 409 and 422), which the screen stands without. */
    suspend fun matchup(
        leagueId: String,
        roster: Int?,
    ): String?

    /** The week's scoreboard, read for another team's game only. */
    suspend fun scoreboard(leagueId: String): String
}

/** The reads through the generated client. */
class ApiMatchupReads(
    private val transport: Transport,
) : MatchupReads {
    override suspend fun sync(leagueId: String): String = transport.leagueSync().leagueSync(UUID.fromString(leagueId)).bodyText()

    override suspend fun matchup(
        leagueId: String,
        roster: Int?,
    ): String? {
        // A 400 (a roster that is no roster id) throws with the API's sentence: a scoreboard's never is.
        val answer = transport.leagueSync().leagueMatchup(UUID.fromString(leagueId), roster = roster)
        return if (answer.status in STANDS_WITHOUT) null else answer.bodyText()
    }

    override suspend fun scoreboard(leagueId: String): String =
        transport.leagueSync().leagueScoreboard(UUID.fromString(leagueId)).bodyText()

    private companion object {
        /** No saved scoring, no current week, a team missing from the read. */
        val STANDS_WITHOUT = setOf(404, 409, 422)
    }
}

/** The cache's key, the route the box score came from (kept with the league read beside it): the member's
 * game, or another team's by its roster, so going back and forth between games never shows one game's
 * saved box under another. */
object MatchupKeys {
    fun matchup(
        leagueId: String,
        roster: Int? = null,
    ): String {
        val base = "/leagues/attached/$leagueId/matchup"
        return roster?.let { "$base?roster=$it" } ?: base
    }
}
