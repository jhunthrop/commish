package app.trycommish.core.trades

import app.trycommish.api.ApiFailure
import app.trycommish.api.Transport
import app.trycommish.api.bodyText
import app.trycommish.api.data
import app.trycommish.api.models.TradeCheck
import app.trycommish.api.models.TradeCheckInput
import java.util.UUID

/** The Trades screen's reads (web TradeScreen.svelte): the trade finder as the API answers it (the
 * envelope's body whole, so the cache keeps exactly what the API sent), narrowed to the trades holding one
 * player by the route's `player` query (the Trades holding picker), and the check of one trade built with
 * both lineups before and after it. A 401 throws [app.trycommish.api.Unauthorized]; a refusal throws
 * [app.trycommish.api.ApiFailure]. */
interface TradeReads {
    /** The finder, or with `player` (a board id) the trades holding him on either side. */
    suspend fun trades(
        leagueId: String,
        player: String?,
    ): String

    /** The check of one trade, null where the API has no check to give: an API older than the route
     * answers its router's 404 (`not_found`), and the screen stands without the scoreboard. Any other 404
     * (the member's team not in the read) throws its sentence, as do a refused trade and a failure. */
    suspend fun checkTrade(
        leagueId: String,
        trade: TradeCheckInput,
    ): TradeCheck?
}

/** The trades' routes through the generated client. */
class ApiTradeReads(
    private val transport: Transport,
) : TradeReads {
    override suspend fun trades(
        leagueId: String,
        player: String?,
    ): String = transport.leagueSync().leagueTrades(UUID.fromString(leagueId), player).bodyText()

    override suspend fun checkTrade(
        leagueId: String,
        trade: TradeCheckInput,
    ): TradeCheck? =
        try {
            transport.leagueSync().checkLeagueTrade(UUID.fromString(leagueId), trade).data()
        } catch (e: ApiFailure) {
            if (TradeKeys.olderApi(e)) null else throw e
        }
}

/** The cache's key, the route the finder came from (a narrowed read is never kept), and the router's
 * answer for a route it does not have. */
object TradeKeys {
    /** The router's code for a route it does not have (httpx.CodeNotFound): an API older than the check. */
    const val ROUTE_NOT_FOUND = "not_found"
    private const val HTTP_NOT_FOUND = 404

    fun trades(leagueId: String): String = "/leagues/attached/$leagueId/trades"

    /** The check's 404 from an API that has no such route. */
    fun olderApi(failure: ApiFailure): Boolean = failure.status == HTTP_NOT_FOUND && failure.code == ROUTE_NOT_FOUND
}
