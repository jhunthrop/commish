package app.trycommish.core.liveorder

import app.trycommish.api.ApiFailure
import app.trycommish.api.decodeEnvelope
import app.trycommish.api.models.DesignationStatus
import app.trycommish.api.models.InjuryDesignation
import app.trycommish.api.models.OrderRow
import app.trycommish.api.models.PlayerWeek
import app.trycommish.api.models.StatusRead
import app.trycommish.core.player.PlayerWeekReads
import app.trycommish.core.rankings.OrderQuery
import app.trycommish.core.rankings.RankingsFixtures
import app.trycommish.core.rankings.RankingsReads
import app.trycommish.core.rankings.WeekPosition
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import java.net.UnknownHostException
import java.text.Normalizer
import java.time.Instant

/** The one-value stand-in's weeks and the parity its screens are held to (shared/fixtures/one-value-run,
 * shared/fixtures/parity/one-value.json, Lane 224's), the iOS OneValueFixture's: each of the three
 * players' week with no league at the order's Sunday clock, his line the Sunday order's. */
object OneValueFixture {
    /** The clock every figure at the read is for, as the fixture files name it. */
    const val CLOCK = RankingsFixtures.SUNDAY

    /** That clock as an instant: Sunday Oct 18 2026, 1:56 pm Central. */
    val now: Instant = Instant.parse("2026-10-18T18:56:00Z")

    private val root = File(requireNotNull(System.getProperty("fixtures")))

    /** His week with no league at the Sunday clock, the body as the API answers it. */
    fun weekAnswer(player: String): String = File(root, "one-value-run/weeks/player-$player-$CLOCK.json").readText()

    fun week(player: String): PlayerWeek = decodeEnvelope(weekAnswer(player))

    /** The whole read the in-season pages take (GET /order with the byes in their places), as it landed
     * at the Sunday clock: the snapshots' order. */
    fun order(): OrderAtClock {
        val body = RankingsFixtures.order("-all", CLOCK)
        return OrderAtClock(body, decodeEnvelope(body), now)
    }

    /** The whole read with one player put on injured reserve after the nightly, as the API answers him
     * (api inseason/order.go): his points and value kept, no place at his position, the list's status the
     * run's capture does not hold, and his row moved after every available player, the rows numbered
     * again (Lane 243 fix round 1, M2). */
    fun listing(id: String): OrderAtClock {
        val order = order()
        val rows = order.answer.rows
        val him = rows.first { it.line.player.boardId == id }
        val others = rows.filter { it !== him }
        val at =
            others
                .indexOfFirst {
                    it.line.facts.designation
                        ?.seasonLong == true
                }.takeIf { it >= 0 } ?: others.size
        val moved = others.take(at) + listOf(designated(him, DesignationStatus.injured_reserve)) + others.drop(at)
        val numbered = moved.mapIndexed { index, row -> row.copy(rank = index + 1, overallRank = index + 1) }
        return OrderAtClock(order.body, order.answer.copy(rows = numbered), order.landed)
    }

    /** The whole read, still uncut, that no longer returns one player the run holds, its statuses read from
     * the hourly capture checked at [STATUS_READ], after the run's (Lane 280, B257): the Board draws him from
     * the run, counts him once and dates its status column by the order's capture. */
    fun omitting(id: String): OrderAtClock {
        val order = order()
        val rows = order.answer.rows.filter { it.line.player.boardId != id }
        val read = StatusRead(asOf = "2026-10-18T15:00:00Z", checkedAt = STATUS_READ, source = "fixture")
        return OrderAtClock(order.body, order.answer.copy(rows = rows, total = rows.size, statusRead = read), order.landed)
    }

    /** The whole read with one player's row holding no figure (a player with no projection), with the
     * week's or the list's `status`, or none. */
    fun unvalued(
        id: String,
        status: DesignationStatus?,
    ): OrderAtClock {
        val order = order()
        val rows =
            order.answer.rows.map { row ->
                if (row.line.player.boardId != id) {
                    row
                } else {
                    designated(
                        row,
                        status,
                    ).let { it.copy(restOfSeasonPoints = null, pointsOverReplacement = null, line = it.line.copy(positionRank = null)) }
                }
            }
        return OrderAtClock(order.body, order.answer.copy(rows = rows), order.landed)
    }

    /** The moment the status is read, after the nightly and before the Sunday clock. */
    private const val STATUS_READ = "2026-10-18T18:00:00Z"

    private val SEASON_LONG =
        setOf(DesignationStatus.injured_reserve, DesignationStatus.pup, DesignationStatus.nfi, DesignationStatus.suspended)

    /** His row under `status` (none for null); a season-long status takes his place at his position. */
    private fun designated(
        row: OrderRow,
        status: DesignationStatus?,
    ): OrderRow {
        val listed = status in SEASON_LONG
        val designation = status?.let { InjuryDesignation(it, STATUS_READ, seasonLong = true.takeIf { listed }) }
        return row.copy(
            line =
                row.line.copy(
                    positionRank = if (listed) null else row.line.positionRank,
                    facts = row.line.facts.copy(designation = designation),
                ),
        )
    }

    /** The parity the screens are held to. */
    val parity: JsonObject by lazy { Json.parseToJsonElement(File(root, "parity/one-value.json").readText()).jsonObject }
}

/**
 * The order's route over the fixture's every-position answers at a clock, as the API answers them (api
 * inseason/order.go), the iOS StubOrderSearch's: with the byes last the Rankings' read (order-<clock>.json,
 * its first hundred rows), else the whole read with the byes in their places (order-all-<clock>.json); a
 * search keeps the rows whose name or club holds the letters, any case, accents aside, each keeping his
 * place; then the read's limit, `total` counting the rows before it; every read failing with no signal
 * while [offline]. It counts each route it is asked, and `rows` trims the whole read for a test.
 */
class StubOrderSearch(
    private val clock: String = OneValueFixture.CLOCK,
    var offline: Boolean = false,
    private val rows: (List<JsonElement>) -> List<JsonElement> = { it },
) : RankingsReads {
    val routes = mutableListOf<String>()

    override suspend fun order(query: OrderQuery): String {
        if (offline) throw UnknownHostException("api.test")
        routes += query.route
        val envelope = Json.parseToJsonElement(RankingsFixtures.order(if (query.byesLast) "" else "-all", clock)).jsonObject
        val data = envelope.getValue("data").jsonObject
        val all =
            data
                .getValue("rows")
                .jsonArray
                .toList()
                .let { if (query.byesLast) it else rows(it) }
        val searched =
            query.search?.let(::folded)?.let { letters ->
                all.filter { row ->
                    val player =
                        row.jsonObject
                            .getValue("line")
                            .jsonObject
                            .getValue("player")
                            .jsonObject
                    listOf("name", "team").any { folded(player.getValue(it).jsonPrimitive.content).contains(letters) }
                }
            } ?: all
        val answer =
            data + mapOf("rows" to JsonArray(searched.drop(query.offset).take(query.limit)), "total" to JsonPrimitive(searched.size))
        return JsonObject(envelope + mapOf("data" to JsonObject(answer))).toString()
    }

    override suspend fun weekOrder(position: WeekPosition): String = RankingsFixtures.weekOrder(position, clock)

    private fun folded(text: String): String = Normalizer.normalize(text, Normalizer.Form.NFD).replace(MARKS, "").lowercase()

    private companion object {
        val MARKS = Regex("\\p{M}+")
    }
}

/** His week over the one-value stand-in, with no league as the public page reads it; the league's read
 * refused (the stand-in follows none), every read failing with no signal while [offline]. */
class StubOneValueWeeks(
    private val offline: Boolean = false,
) : PlayerWeekReads {
    override suspend fun leagueWeek(
        league: String,
        player: String,
    ): String = throw ApiFailure(NOT_FOUND, "not_found", "The stand-in follows no league.")

    override suspend fun publicWeek(player: String): String {
        if (offline) throw UnknownHostException("api.test")
        return OneValueFixture.weekAnswer(player)
    }

    private companion object {
        const val NOT_FOUND = 404
    }
}

/** A clock the test moves. */
class MovingClock(
    var at: Instant,
) : app.trycommish.core.Clock {
    override fun now(): Instant = at
}
