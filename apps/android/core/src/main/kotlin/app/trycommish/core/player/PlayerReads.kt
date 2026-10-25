package app.trycommish.core.player

import app.trycommish.api.Transport
import app.trycommish.api.bodyText
import app.trycommish.core.board.RunRead
import app.trycommish.core.board.runRead
import java.util.UUID

/** The run's player pages as the API serves them (Lane 188's routes, the files the site's player page is
 * built from): the index that names each page by its slug, a player's page, the pages the nightly held and
 * an earlier run's copy of one, and the schedule. Each read names the ETag the app kept, and a 304 says
 * the kept copy stands. A refused page answers its error envelope, which the reader decodes and never
 * keeps. A 401 throws [app.trycommish.api.Unauthorized]. */
interface PlayerPageReads {
    suspend fun index(tag: String?): RunRead

    suspend fun page(
        id: String,
        tag: String?,
    ): RunRead

    suspend fun held(tag: String?): RunRead

    suspend fun heldCopy(
        id: String,
        tag: String?,
    ): RunRead

    suspend fun schedule(tag: String?): RunRead
}

/** A player's week as his card reads it (web/src/lib/player/live.ts readWeek), each answer's body whole: the
 * Lineup row's figures in the league's scoring with the one verb its screens give him, or with no league
 * in PPR. `player` is his board id. */
interface PlayerWeekReads {
    /** GET /leagues/attached/{id}/players/{player}: his week in the member's league, the verb with it. */
    suspend fun leagueWeek(
        league: String,
        player: String,
    ): String

    /** GET /players/{player}/week: his week with no league, in PPR, no verb. */
    suspend fun publicWeek(player: String): String
}

/** Both through the generated client. */
class ApiPlayerReads(
    private val transport: Transport,
) : PlayerPageReads,
    PlayerWeekReads {
    override suspend fun index(tag: String?): RunRead = transport.run().runIndex(tag).runRead()

    override suspend fun page(
        id: String,
        tag: String?,
    ): RunRead = transport.run().runPlayer(id, tag).runRead()

    override suspend fun held(tag: String?): RunRead = transport.run().runHeld(tag).runRead()

    override suspend fun heldCopy(
        id: String,
        tag: String?,
    ): RunRead = transport.run().runHeldCopy(id, tag).runRead()

    override suspend fun schedule(tag: String?): RunRead = transport.run().runSchedule(tag).runRead()

    override suspend fun leagueWeek(
        league: String,
        player: String,
    ): String = transport.leagueSync().leaguePlayerWeek(UUID.fromString(league), player, null, null, null).bodyText()

    override suspend fun publicWeek(player: String): String = transport.leagueSync().playerWeek(player, null, null, null).bodyText()
}
