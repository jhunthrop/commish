package app.trycommish.core.waivers

import app.trycommish.api.Transport
import app.trycommish.api.bodyText
import app.trycommish.api.data
import app.trycommish.api.models.HostMoveConfirm
import app.trycommish.api.models.HostMoveInput
import app.trycommish.api.models.HostMovePlan
import app.trycommish.api.models.HostMoveResult
import java.util.UUID

/** The Waivers screen's reads and writes (web WaiverScreen.svelte): the league's waivers as the API
 * answers them (the envelope's body whole, so the cache keeps exactly what the API sent), narrowed to one
 * position by the route's `position` query, and the claim, planned in words with a confirm token and then
 * made once with it. A 401 throws [app.trycommish.api.Unauthorized]; a refusal throws
 * [app.trycommish.api.ApiFailure]. */
interface WaiverReads {
    /** The page's answer, or with a position that position's own read (past the page's first 60 rows). */
    suspend fun waivers(
        leagueId: String,
        position: WaiverPosition?,
    ): String

    /** Plans the claim against a fresh read of the league: nothing is sent to the platform. */
    suspend fun planMove(
        leagueId: String,
        move: HostMoveInput,
    ): HostMovePlan

    /** Makes the planned claim once with its token: sent to the platform once, never retried. */
    suspend fun makeMove(
        leagueId: String,
        move: HostMoveInput,
        confirm: String,
    ): HostMoveResult
}

/** The waivers' routes through the generated client. */
class ApiWaiverReads(
    private val transport: Transport,
) : WaiverReads {
    override suspend fun waivers(
        leagueId: String,
        position: WaiverPosition?,
    ): String = transport.leagueSync().leagueWaivers(UUID.fromString(leagueId), position?.query, null).bodyText()

    override suspend fun planMove(
        leagueId: String,
        move: HostMoveInput,
    ): HostMovePlan = transport.leagueSync().planHostMove(UUID.fromString(leagueId), move).data()

    override suspend fun makeMove(
        leagueId: String,
        move: HostMoveInput,
        confirm: String,
    ): HostMoveResult = transport.leagueSync().makeHostMove(UUID.fromString(leagueId), HostMoveConfirm(move, confirm)).data()
}

/** The cache's key, the route the page's waivers came from (a position's read is never kept). */
object WaiverKeys {
    fun waivers(leagueId: String): String = "/leagues/attached/$leagueId/waivers"
}
