package app.trycommish.core.player

import app.trycommish.api.ApiFailure
import app.trycommish.api.decodeEnvelope
import app.trycommish.api.models.PlayerWeek
import app.trycommish.api.models.RunPlayer
import app.trycommish.api.models.RunPlayerAnswer
import app.trycommish.core.Cache
import app.trycommish.core.Clock
import app.trycommish.core.SessionEnd
import app.trycommish.core.board.RunFixture
import app.trycommish.core.board.RunRead
import app.trycommish.core.board.StubRunReads
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import java.io.File
import java.net.UnknownHostException
import java.time.Instant
import java.time.ZoneId

/** The fixture league's player weeks (shared/fixtures/inseason, export-fixtures.ts): his week in the league,
 * the verb with it, at the sheet's clocks, and with no league at the week's, as the iOS WeekFixture. */
object WeekFixture {
    /** The fixture league (web/scripts/inseason-fixture/ids.ts). */
    const val LEAGUE = "6f1d1c52-2626-4a26-9a26-000000000026"

    /** The fixture clocks (web/scripts/inseason-fixture/clock.ts). */
    val week: Instant = Instant.parse("2026-10-17T17:00:00Z")
    val sunday: Instant = Instant.parse("2026-10-18T18:56:00Z")
    val monday: Instant = Instant.parse("2026-10-19T16:00:00Z")

    /** The zone the web's fixture shots and the parity draw in. */
    val zone: ZoneId = ZoneId.of("America/Chicago")

    private val folder: File get() = File(System.getProperty("fixtures"), "inseason")

    /** An instant as a fixture file names it: 18:56 UTC on Oct 18 as `2026-10-18T18-56-00Z`. */
    fun clockPart(at: Instant): String = at.toString().replace(":", "-")

    fun leagueAnswer(
        player: String,
        at: Instant,
    ): String = File(folder, "player-$LEAGUE-$player-${clockPart(at)}.json").readText()

    fun publicAnswer(
        player: String,
        at: Instant,
    ): String = File(folder, "player-$player-${clockPart(at)}.json").readText()

    fun league(
        player: String,
        at: Instant,
    ): PlayerWeek = decodeEnvelope(leagueAnswer(player, at))

    fun publicWeek(
        player: String,
        at: Instant,
    ): PlayerWeek = decodeEnvelope(publicAnswer(player, at))
}

/** The fixture run's player page as the app reads it. */
fun RunFixture.page(id: String): RunPlayer = decodeEnvelope<RunPlayerAnswer>(pageAnswer(id)).player

/**
 * The page routes over a fixture run, as the API answers them: each file with its ETag, unchanged (304)
 * when the read names that ETag; a page the run lacks, or one it holds, refused with its envelope as the
 * API refuses it; and every read failing with no signal while [offline]. `held` names the pages the run
 * holds, each with the earlier run whose copy stands in for it (null for none). It counts the reads.
 */
class StubPages(
    var fixture: RunFixture,
    private val held: Map<String, RunFixture?> = emptyMap(),
    var offline: Boolean = false,
) : PlayerPageReads {
    /** Each read's file and the ETag it named, in order. */
    val sent = mutableListOf<Pair<String, String?>>()

    override suspend fun index(tag: String?): RunRead = read("index.json", tag) { fixture.indexAnswer() }

    override suspend fun page(
        id: String,
        tag: String?,
    ): RunRead {
        if (id in held || id !in fixture.playerIds()) return refusal("players/$id.json")
        return read("players/$id.json", tag) { fixture.pageAnswer(id) }
    }

    override suspend fun held(tag: String?): RunRead =
        read("held.json", tag) {
            val pages =
                held.keys.sorted().map { id ->
                    val copy =
                        held[id]?.let { run ->
                            val manifest =
                                Json
                                    .parseToJsonElement(run.manifestAnswer())
                                    .jsonObject
                                    .getValue("data")
                                    .jsonObject
                            val runAt = manifest.getValue("manifest").jsonObject.getValue("runAt")
                            JsonObject(mapOf("runId" to JsonPrimitive(run.runId), "runAt" to runAt))
                        }
                    JsonObject(mapOf("id" to JsonPrimitive(id), "copy" to (copy ?: JsonNull)))
                }
            val answer = if (pages.isEmpty()) JsonNull else JsonObject(mapOf("pages" to JsonArray(pages)))
            envelope(JsonObject(mapOf("run_id" to JsonPrimitive(fixture.runId), "held" to answer)))
        }

    override suspend fun heldCopy(
        id: String,
        tag: String?,
    ): RunRead {
        val copy = held[id] ?: return refusal("held/$id.json")
        return read("held/$id.json", tag) { copy.pageAnswer(id) }
    }

    override suspend fun schedule(tag: String?): RunRead = read("schedule.json", tag) { fixture.scheduleAnswer() }

    private fun refusal(file: String): RunRead {
        if (offline) throw UnknownHostException("api.test")
        sent += file to null
        return RunRead.Fresh(REFUSED, null)
    }

    private fun read(
        file: String,
        tag: String?,
        body: () -> String,
    ): RunRead {
        if (offline) throw UnknownHostException("api.test")
        sent += file to tag
        val current = fixture.tag(file)
        return if (tag == current) RunRead.Unchanged(current) else RunRead.Fresh(body(), current)
    }

    private fun envelope(data: JsonObject): String =
        JsonObject(
            mapOf("ok" to JsonPrimitive(true), "data" to data, "error" to JsonNull, "request_id" to JsonPrimitive("fixture")),
        ).toString()

    private companion object {
        const val REFUSED =
            "{\"ok\":false,\"data\":null,\"error\":{\"code\":\"not_found\",\"message\":\"The run held this page.\"},\"request_id\":\"fixture\"}"
    }
}

/** The weeks over the fixture league at a clock, counting each read; every read failing with no signal
 * while [offline], and the league's failing alone while [leagueFails]. */
class StubWeeks(
    var at: Instant = WeekFixture.week,
    var offline: Boolean = false,
    var leagueFails: Boolean = false,
) : PlayerWeekReads {
    /** Each read: "league:<id>" or "public:<id>". */
    val reads = mutableListOf<String>()

    override suspend fun leagueWeek(
        league: String,
        player: String,
    ): String {
        if (offline) throw UnknownHostException("api.test")
        reads += "league:$player"
        if (leagueFails) throw ApiFailure(BAD_GATEWAY, "bad_gateway", "The platform did not answer.")
        return WeekFixture.leagueAnswer(player, at)
    }

    override suspend fun publicWeek(player: String): String {
        if (offline) throw UnknownHostException("api.test")
        reads += "public:$player"
        return WeekFixture.publicAnswer(player, at)
    }

    private companion object {
        const val BAD_GATEWAY = 502
    }
}

/** The reads every sheet and page test builds its view model over. */
fun playerGraph(
    run: StubRunReads,
    pages: StubPages,
    weeks: StubWeeks,
    cache: Cache,
    clock: Clock,
    sessionEnd: SessionEnd = SessionEnd {},
): PlayerReadsGraph = PlayerReadsGraph(run, pages, weeks, cache, clock, WeekFixture.zone, sessionEnd)
