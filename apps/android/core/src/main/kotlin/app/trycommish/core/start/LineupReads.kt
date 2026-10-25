package app.trycommish.core.start

import app.trycommish.api.Transport
import app.trycommish.api.bodyText
import app.trycommish.api.data
import app.trycommish.api.models.HostMoveConfirm
import app.trycommish.api.models.HostMoveInput
import app.trycommish.api.models.HostMovePlan
import app.trycommish.api.models.HostMoveResult
import java.util.UUID

/** The Start screen's reads and writes (web StartScreen.svelte): the week's lineup as the API answers it
 * (the envelope's body whole, so the cache keeps exactly what the API sent), and the move that sets it on
 * the platform, planned in words with a confirm token and then made once with it (spec §10.2). A 401
 * throws [app.trycommish.api.Unauthorized]; a refusal throws [app.trycommish.api.ApiFailure]. */
interface LineupReads {
    suspend fun lineup(leagueId: String): String

    /** Plans the move against a fresh read of the league: nothing is sent to the platform. */
    suspend fun planMove(
        leagueId: String,
        move: HostMoveInput,
    ): HostMovePlan

    /** Makes the planned move once with its token: sent to the platform once, never retried. */
    suspend fun makeMove(
        leagueId: String,
        move: HostMoveInput,
        confirm: String,
    ): HostMoveResult
}

/** The lineup's routes through the generated client. */
class ApiLineupReads(
    private val transport: Transport,
) : LineupReads {
    override suspend fun lineup(leagueId: String): String = transport.leagueSync().leagueLineup(UUID.fromString(leagueId)).bodyText()

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

/** The cache's key, the route the lineup came from. */
object StartKeys {
    fun lineup(leagueId: String): String = "/leagues/attached/$leagueId/lineup"
}
