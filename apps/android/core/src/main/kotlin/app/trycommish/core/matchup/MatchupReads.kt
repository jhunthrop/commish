package app.trycommish.core.matchup

import app.trycommish.api.Transport
import app.trycommish.api.bodyText
import java.util.UUID

/** The Matchup screen's reads (web MatchupScreen.svelte): the league read, whose matchup keeps the score
 * and the teams, and the week's matchup as a box score, each the envelope's body whole. A 401 throws
 * [app.trycommish.api.Unauthorized]. */
interface MatchupReads {
    suspend fun sync(leagueId: String): String

    /** The box score, null where the API has none for the league (MatchupScreen's STANDS_WITHOUT: 404,
     * 409 and 422), which the screen stands without. */
    suspend fun matchup(leagueId: String): String?
}

/** The reads through the generated client. */
class ApiMatchupReads(
    private val transport: Transport,
) : MatchupReads {
    override suspend fun sync(leagueId: String): String = transport.leagueSync().leagueSync(UUID.fromString(leagueId)).bodyText()

    override suspend fun matchup(leagueId: String): String? {
        val answer = transport.leagueSync().leagueMatchup(UUID.fromString(leagueId))
        return if (answer.status in STANDS_WITHOUT) null else answer.bodyText()
    }

    private companion object {
        /** No saved scoring, no current week, a team missing from the read. */
        val STANDS_WITHOUT = setOf(404, 409, 422)
    }
}

/** The cache's key, the route the box score came from (kept with the league read beside it). */
object MatchupKeys {
    fun matchup(leagueId: String): String = "/leagues/attached/$leagueId/matchup"
}
