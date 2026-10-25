package app.trycommish.core.board

import app.trycommish.api.ApiFailure
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import java.net.UnknownHostException
import java.time.Instant
import java.time.ZoneId

/**
 * A fixture run as the API's run routes answer it (Lane 185, api/internal/runs), the iOS RunFixtures'
 * twin: a folder in the bucket's layout under shared/fixtures, its manifest, a format's board split as
 * the API splits it (the ranked rows, then the kickers and defenses, each in the file's order), the
 * ADP, the clubs and the designations, each in the API's envelope, with the ETag the API gives it.
 */
enum class RunFixture(
    private val folder: String,
) {
    /** The contract run, shared/fixtures/run: in season, the rest of the season from week 7, four players. */
    Contract("run"),

    /** The stand-in, shared/fixtures/standin-run: the PPR board of the full season before the draft. */
    StandIn("standin-run"),
    ;

    private val root: File get() = File(System.getProperty("fixtures"), folder)

    /** The run the folder's latest pointer names. */
    val runId: String
        get() = obj("runs/latest.json").getValue("runId").jsonPrimitive.content

    fun manifestAnswer(): String = envelope("manifest" to runFile("manifest.json"))

    fun boardAnswer(format: String): String {
        val rows = runFile("boards/$format.json").jsonObject.getValue("rows").jsonArray
        val market = rows.filter { basis(it) == "market" }
        val ranked = rows.filter { basis(it) != "market" }
        return envelope("format" to JsonPrimitive(format), "rows" to JsonArray(ranked), "market" to JsonArray(market))
    }

    fun adpAnswer(): String = envelope("adp" to runFile("adp.json"))

    fun clubsAnswer(): String = envelope("clubs" to runFile("clubs.json"))

    fun designationsAnswer(): String = envelope("designations" to runFile("designations.json"))

    /** His page as /run/players/{id} answers it: the run it is from and the page. */
    fun pageAnswer(id: String): String = envelope("player" to runFile("players/$id.json"))

    /** The run's schedule as /run/schedule answers it. */
    fun scheduleAnswer(): String = envelope("schedule" to runFile("schedule.json"))

    /** The pages the folder holds, each by the index's own fields, as /run/index answers them. */
    fun indexAnswer(): String {
        val entries =
            playerIds().map { id ->
                val page = runFile("players/$id.json").jsonObject
                val season = page.getValue("season").jsonObject
                val games = mapOf("games" to season.getValue("games"), "pointsPerGame" to (season["pointsPerGame"] ?: JsonNull))
                JsonObject(INDEX_FIELDS.associateWith { page.getValue(it) } + mapOf("season" to JsonObject(games)))
            }
        return envelope("pages" to JsonArray(entries), "market" to JsonArray(emptyList()))
    }

    /** The ids of the pages the run holds, in file order. */
    fun playerIds(): List<String> =
        File(root, "runs/$runId/players")
            .listFiles()
            .orEmpty()
            .map { it.name }
            .filter { it.endsWith(".json") }
            .sorted()
            .map { it.removeSuffix(".json") }

    /** Whether the run carries a format's board. */
    fun carries(format: String): Boolean = File(root, "runs/$runId/boards/$format.json").exists()

    /** The ETag the API gives a file of this run: weak, the run id and the file. */
    fun tag(file: String): String = "W/\"$runId/$file\""

    /** Every file of a format's board kept as the reader keeps them, each with its ETag. */
    fun bodies(format: String = PPR): RunBoardBodies =
        RunBoardBodies(
            format = format,
            manifest = KeptBody(manifestAnswer(), tag("manifest.json")),
            board = KeptBody(boardAnswer(format), tag("boards/$format.json")),
            adp = KeptBody(adpAnswer(), tag("adp.json")),
            designations = KeptBody(designationsAnswer(), tag("designations.json")),
            clubs = KeptBody(clubsAnswer(), tag("clubs.json")),
        )

    fun read(format: String = PPR): RunBoardRead = RunBoardRead.of(bodies(format))

    private fun basis(row: JsonElement): String? = (row.jsonObject["orderBasis"] as? JsonPrimitive)?.content

    private fun runFile(path: String): JsonElement = Json.parseToJsonElement(File(root, "runs/$runId/$path").readText())

    private fun obj(path: String): JsonObject = Json.parseToJsonElement(File(root, path).readText()).jsonObject

    private fun envelope(vararg data: Pair<String, JsonElement>): String =
        JsonObject(
            mapOf(
                "ok" to JsonPrimitive(true),
                "data" to JsonObject(mapOf("run_id" to JsonPrimitive(runId)) + data),
                "error" to JsonNull,
                "request_id" to JsonPrimitive("fixture"),
            ),
        ).toString()

    companion object {
        const val PPR = "ppr-12"

        /** The page's own fields the run's index names each page by. */
        private val INDEX_FIELDS = listOf("id", "slug", "name", "team", "position", "headshot")

        /** The member's zone the web's shots draw in. */
        val zone: ZoneId = ZoneId.of("America/Chicago")

        /** The clocks the iOS mock draws at: before the draft, and in season on the contract run's week. */
        val preDraft: Instant = Instant.parse("2026-09-01T17:00:00Z")
        val inSeason: Instant = Instant.parse("2026-10-22T17:00:00Z")
    }
}

/**
 * The run routes over a fixture run, as the API answers them: each file with its ETag, unchanged (304)
 * when the read names that ETag, every read failing with no signal while [offline]. It counts each
 * route's answers and keeps every ETag it was sent, so a test sees the 304s and the raw tags.
 */
class StubRunReads(
    var fixture: RunFixture,
    var offline: Boolean = false,
) : RunReads {
    /** Each read's file and the ETag it named, in order. */
    val sent = mutableListOf<Pair<String, String?>>()

    /** Each read's answer: 200 or 304. */
    val answered = mutableListOf<Int>()

    override suspend fun manifest(tag: String?): RunRead = read("manifest.json", tag) { fixture.manifestAnswer() }

    override suspend fun board(
        format: String,
        tag: String?,
    ): RunRead {
        // The API answers 404 for a format the run lacks (the contract run lists three, carries PPR's).
        if (!fixture.carries(format) && !offline) throw ApiFailure(NOT_FOUND, "not_found", "The run has no $format board.")
        return read("boards/$format.json", tag) { fixture.boardAnswer(format) }
    }

    override suspend fun adp(tag: String?): RunRead = read("adp.json", tag) { fixture.adpAnswer() }

    override suspend fun designations(tag: String?): RunRead = read("designations.json", tag) { fixture.designationsAnswer() }

    override suspend fun clubs(tag: String?): RunRead = read("clubs.json", tag) { fixture.clubsAnswer() }

    private fun read(
        file: String,
        tag: String?,
        body: () -> String,
    ): RunRead {
        if (offline) throw UnknownHostException("api.test")
        sent += file to tag
        val current = fixture.tag(file)
        return if (tag == current) {
            answered += NOT_MODIFIED
            RunRead.Unchanged(current)
        } else {
            answered += OK
            RunRead.Fresh(body(), current)
        }
    }

    private companion object {
        const val NOT_FOUND = 404
        const val OK = 200
        const val NOT_MODIFIED = 304
    }
}
