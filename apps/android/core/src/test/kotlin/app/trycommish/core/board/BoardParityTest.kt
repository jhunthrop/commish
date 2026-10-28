package app.trycommish.core.board

import app.trycommish.core.liveorder.LiveOrder
import app.trycommish.core.liveorder.LiveOrderWords
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.double
import kotlinx.serialization.json.int
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.File
import java.time.Instant
import java.time.ZoneId

/**
 * The Board's words and figures held to the web's, as the iOS BoardParityTests hold them: boardWords for
 * every rail, view, league state and cover, a row's figures and the capture's few words
 * (shared/fixtures/parity/board.json); and over the two fixture runs (board-run.json), every view's rows
 * in the web's order with their statuses, byes, tints, tiers and cliffs, the phone's basis, the run's
 * stamp, the offline lead and the rest of the season's caption.
 */
class BoardParityTest {
    private val parity = parsed("board.json")
    private val runParity = parsed("board-run.json")

    private fun parsed(name: String): JsonObject =
        Json.parseToJsonElement(File(System.getProperty("fixtures"), "parity/$name").readText()).jsonObject

    private fun JsonObject.text(key: String): String? = (get(key) as? JsonElement)?.takeIf { it != JsonNull }?.jsonPrimitive?.contentOrNull

    private fun JsonObject.string(key: String): String = requireNotNull(text(key)) { "$key is missing" }

    private fun wordsOf(words: BoardWords): Map<String, String?> =
        mapOf("bar" to words.bar, "title" to words.title, "heading" to words.heading, "verb" to words.verb?.id)

    private fun wordsOf(json: JsonObject): Map<String, String?> = listOf("bar", "title", "heading", "verb").associateWith { json.text(it) }

    @Test
    fun `every rail's words for the board are the web's`() {
        val season = parity.getValue("season").jsonPrimitive.int
        val cases = parity.getValue("words").jsonArray.map { it.jsonObject }
        assertTrue(cases.size > 40)
        cases.forEach { item ->
            val rail = item.string("rail")
            val inSeason = rail == "in_season" || rail.startsWith("playoffs")
            val cover =
                BoardCover(
                    season = season,
                    label = parity.string("label"),
                    position = item.text("position"),
                    restOfSeason = item["rosFromWeek"]?.takeIf { it != JsonNull } != null,
                )
            val following = item.getValue("following").jsonPrimitive.booleanOrNull == true
            val said = wordsOf(BoardWords.of(inSeason, cover, following))
            assertEquals(wordsOf(item.getValue("words").jsonObject), said, "$rail ${item.text("position")} $following")
        }
    }

    @Test
    fun `a row's figures print as the web's do`() {
        parity.getValue("figures").jsonArray.map { it.jsonObject }.forEach { figure ->
            val value = figure.getValue("value").jsonPrimitive.double
            assertEquals(figure.string("projected"), BoardFigures.projected(value), "$value")
            assertEquals(figure.string("overReplacement"), BoardFigures.signed(value), "$value")
            assertEquals(figure.string("gap"), BoardFigures.gap(value), "$value")
        }
        assertEquals(parity.string("noGap"), BoardFigures.gap(null))
    }

    @Test
    fun `the capture's few words are the web's`() {
        val zone = ZoneId.of(parity.string("zone"))
        parity.getValue("captures").jsonArray.map { it.jsonObject }.forEach { capture ->
            val said =
                BoardWords.capture(
                    asOf = Instant.parse(capture.string("readAt")),
                    checkedAt = capture.text("checkedAt")?.let(Instant::parse),
                    now = Instant.parse(capture.string("now")),
                    zone = zone,
                )
            assertEquals(capture.string("text"), said)
        }
    }

    private fun stampOf(json: JsonObject?): CaptureStamp? =
        json?.let { CaptureStamp(Instant.parse(it.string("readAt")), it.text("checkedAt")?.let(Instant::parse)) }

    @Test
    fun `the status column's stamp is the newer of the run's capture and the order's, as the web's (Lane 280)`() {
        val zone = ZoneId.of(runParity.string("zone"))
        val cases = runParity.getValue("liveStamps").jsonArray.map { it.jsonObject }
        assertEquals(
            listOf("run-only", "live-newer", "live-newer-unchecked", "live-newer-earlier-day", "live-older"),
            cases.map {
                it.string("name")
            },
        )
        cases.forEach { case ->
            val run = stampOf(case.getValue("run").jsonObject)
            val live = stampOf(case["live"]?.takeIf { it != JsonNull }?.jsonObject)
            val chosen = requireNotNull(CaptureStamp.newer(run, live))
            assertEquals(case.string("chosen"), if (live != null && chosen === live) "live" else "run", case.string("name"))
            assertEquals(case.string("text"), BoardWords.capture(chosen, Instant.parse(case.string("now")), zone), case.string("name"))
        }
    }

    @Test
    fun `the run's players an uncut order omits are counted as the web counts them (Lane 280)`() {
        runParity.getValue("fromRun").jsonArray.map { it.jsonObject }.forEach { case ->
            val runIds = case.getValue("runIds").jsonArray.map { it.jsonPrimitive.content }
            val answerIds = case.getValue("answerIds").jsonArray.map { it.jsonPrimitive.content }
            val cut = case.getValue("total").jsonPrimitive.int > answerIds.size
            val omitted = LiveOrder.omittedFromRun(runIds, answerIds.toSet(), cut)
            assertEquals(case.getValue("omitted").jsonArray.map { it.jsonPrimitive.content }, omitted, case.string("name"))
            assertEquals(case.text("line"), LiveOrderWords.fromRun(omitted.size), case.string("name"))
        }
    }

    @Test
    fun `the kickers' basis with no drafts named is the web's`() {
        val draftOrder =
            parity
                .getValue("basis")
                .jsonArray
                .map { it.jsonObject }
                .single { it.string("view") == "draftOrder" }
        val format =
            RunFixture.StandIn
                .read()
                .format
                .copy(marketOrder = null)
        assertEquals(
            draftOrder.getValue("parts").jsonArray.map { it.jsonPrimitive.content },
            listOf(BoardBasis.draftOrder(format, emptyList())),
        )
    }

    // The run's board, view by view.

    private val runs = runParity.getValue("runs").jsonArray.map { it.jsonObject }

    private fun fixtureOf(run: JsonObject): RunFixture =
        if (run.string("fixture").endsWith("standin-run")) RunFixture.StandIn else RunFixture.Contract

    private fun model(
        run: JsonObject,
        position: String?,
    ): BoardModel =
        BoardModel.of(
            read = fixtureOf(run).read(run.string("format")),
            position = position?.let(BoardPosition::of),
            inSeason = run.getValue("words").jsonObject.text("verb") != PageVerb.Mock.id,
            following = false,
            now = Instant.parse(run.string("now")),
            zone = ZoneId.of(runParity.string("zone")),
        )

    /** In season a ranked view's basis ends with the run's stamp while the order is unread (Lane 226): the
     * web's page says it after the basis the parity holds (live-order.ts basisAtClock). */
    private fun stamp(
        run: JsonObject,
        position: String?,
    ): List<String> {
        val draftOrder = position?.let(BoardPosition::of)?.draftOrder == true
        if (run.getValue("words").jsonObject.text("verb") == PageVerb.Mock.id || draftOrder) return emptyList()
        val format = fixtureOf(run).read(run.string("format")).format
        return listOfNotNull(LiveOrderWords.runStamp(format, ZoneId.of(runParity.string("zone"))))
    }

    @Test
    fun `the run's stamp, heading and rest of season are the web's`() {
        assertEquals(2, runs.size)
        runs.forEach { run ->
            val model = model(run, null)
            assertEquals(run.string("stamp"), model.stamp)
            assertEquals(run.string("offline"), RunWords.offline(fixtureOf(run).read().manifest))
            assertEquals(run.text("restCaption"), model.restLine)
            assertEquals(wordsOf(run.getValue("words").jsonObject), wordsOf(model.words))
        }
    }

    @Test
    fun `every view lists the web's rows, tiers and basis`() {
        runs.forEach { run ->
            val views = run.getValue("views").jsonArray.map { it.jsonObject }
            assertTrue(views.size > 1)
            views.forEach { view ->
                val position = view.text("position")
                val model = model(run, position)
                val name = "${run.string("runId")} ${position ?: "All"}"
                assertEquals(view.getValue("ids").jsonArray.map { it.jsonPrimitive.content }, model.rows.map { it.id }, name)
                val tiers =
                    model.sections.mapNotNull { section ->
                        section.band?.let {
                            listOf(
                                it.tier.toString(),
                                section.rows
                                    .map { row ->
                                        row.id
                                    }.toString(),
                                it.name,
                                it.count,
                                it.cliff,
                            )
                        }
                    }
                val expected =
                    view.getValue("tiers").jsonArray.map { it.jsonObject }.map {
                        listOf(
                            it
                                .getValue("tier")
                                .jsonPrimitive.int
                                .toString(),
                            it
                                .getValue("ids")
                                .jsonArray
                                .map { id -> id.jsonPrimitive.content }
                                .toString(),
                            it.string("name"),
                            it.string("count"),
                            it.string("cliff"),
                        )
                    }
                assertEquals(expected, tiers, name)
                val capture =
                    if (view.getValue("capture").jsonPrimitive.booleanOrNull ==
                        true
                    ) {
                        listOfNotNull(run.text("capture"))
                    } else {
                        emptyList()
                    }
                assertEquals(
                    view.getValue("basis").jsonArray.map { it.jsonPrimitive.content } + capture + stamp(run, position),
                    model.basis,
                    name,
                )
            }
        }
    }

    @Test
    fun `every row's tint, bye and status are the web's`() {
        runs.forEach { run ->
            val model = model(run, null)
            val heats = run.getValue("heats").jsonObject
            val byes = run.getValue("byes").jsonObject
            val statuses = run.getValue("statuses").jsonObject
            assertEquals(heats.size, model.rows.size)
            model.rows.forEach { row ->
                assertEquals(heats.getValue(row.id).jsonPrimitive.content, row.heat.id, row.name)
                assertEquals(byes[row.id]?.takeIf { it != JsonNull }?.jsonPrimitive?.content, row.bye, row.name)
                val expected =
                    statuses[row.id]?.jsonObject?.let {
                        Triple(it.text("rank"), it.string("mark"), it.getValue("sits").jsonPrimitive.booleanOrNull == true)
                    }
                assertEquals(expected, row.status?.let { Triple(it.rank, it.mark, it.sits) }, row.name)
            }
            assertEquals(run.text("capture"), model.basis.dropLast(stamp(run, null).size).last())
        }
    }

    @Test
    fun `the fixture runs are the ones the parity file names`() {
        runs.forEach { run -> assertEquals(run.string("runId"), fixtureOf(run).runId) }
        // A run's rest-of-season week as the manifest carries it.
        assertEquals(
            7,
            RunFixture.Contract
                .read()
                .format.rosFromWeek,
        )
        assertEquals(
            null,
            runs
                .first()
                .getValue("restCaption")
                .jsonPrimitive.intOrNull,
        )
    }
}
