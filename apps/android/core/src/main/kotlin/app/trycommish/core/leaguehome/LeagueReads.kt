package app.trycommish.core.leaguehome

import app.trycommish.api.Transport
import app.trycommish.api.bodyText
import java.util.UUID

/** The League tab's reads as the API answers them, the envelope's body whole, so the cache keeps
 * exactly what the API sent. A 401 throws [app.trycommish.api.Unauthorized]. */
interface LeagueReads {
    suspend fun sync(leagueId: String): String

    suspend fun scoreboard(leagueId: String): String
}

/** The reads through the generated client. */
class ApiLeagueReads(
    private val transport: Transport,
) : LeagueReads {
    override suspend fun sync(leagueId: String): String = transport.leagueSync().leagueSync(UUID.fromString(leagueId)).bodyText()

    override suspend fun scoreboard(leagueId: String): String =
        transport.leagueSync().leagueScoreboard(UUID.fromString(leagueId)).bodyText()
}

/** The cache's keys, the routes the answers came from. */
object LeagueHomeKeys {
    fun sync(leagueId: String): String = "/leagues/attached/$leagueId/sync"

    fun scoreboard(leagueId: String): String = "/leagues/attached/$leagueId/scoreboard"
}
