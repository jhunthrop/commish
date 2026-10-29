package app.trycommish.core.player

import app.trycommish.api.CommishJson
import app.trycommish.api.decodeEnvelope
import app.trycommish.api.models.PlayerWeekRead
import app.trycommish.api.models.RunDesignations
import app.trycommish.api.models.RunManifestAnswer
import app.trycommish.api.models.RunReadsDue
import app.trycommish.api.models.RunWeekRead
import app.trycommish.core.board.RunFixture
import app.trycommish.core.start.GameRead
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.File
import java.time.Instant
import java.time.ZoneId

/** The parity file the sheet and the page are held to, as the tests read it. */
internal object SheetParity {
    val json: JsonObject by lazy {
        Json.parseToJsonElement(File(System.getProperty("fixtures"), "parity/player-sheet.json").readText()).jsonObject
    }
    val zone: ZoneId by lazy { ZoneId.of(json.string("zone")) }

    fun cases(key: String): List<JsonObject> = json.getValue(key).jsonArray.map { it.jsonObject }

    fun state(name: String?): GameRead? =
        when (name) {
            "upcoming" -> GameRead.Upcoming
            "kicked_off" -> GameRead.KickedOff
            "final" -> GameRead.Final
            else -> null
        }

    fun run(name: String): RunFixture = if (name == "contract") RunFixture.Contract else RunFixture.StandIn

    fun manifest(run: RunFixture): RunManifestAnswer = decodeEnvelope(run.manifestAnswer())

    fun capture(run: RunFixture): RunDesignations? =
        decodeEnvelope<app.trycommish.api.models.RunDesignationsAnswer>(run.designationsAnswer()).designations

    fun readOf(element: JsonElement): RunWeekRead = CommishJson.decodeFromJsonElement(RunWeekRead.serializer(), element)

    fun captureOf(element: JsonElement?): RunDesignations? =
        element?.takeIf { it != JsonNull }?.let { CommishJson.decodeFromJsonElement(RunDesignations.serializer(), it) }
}

internal fun JsonObject.text(key: String): String? = get(key)?.takeIf { it != JsonNull }?.jsonPrimitive?.contentOrNull

internal fun JsonObject.string(key: String): String = requireNotNull(text(key)) { "$key is missing" }

internal fun JsonObject.obj(key: String): JsonObject? = get(key)?.takeIf { it != JsonNull }?.jsonObject

/**
 * The player sheet held to the web's shelf (shared/fixtures/parity/player-sheet.json), as the iOS
 * PlayerSheetParityTests hold it: every held-read case of the web's own tests, the status rule's at the
 * build's clocks and its hourly passes, and each sheet player at each fixture clock, his head, game cell,
 * figures, basis lines and read exactly as the shelf prints them.
 */
class PlayerSheetParityTest {
    private fun shown(read: ShownRead): Map<String, Any?> =
        when (read) {
            is ShownRead.Written -> mapOf("withheld" to false, "body" to read.body, "caption" to read.caption, "words" to null)
            is ShownRead.Withheld -> mapOf("withheld" to true, "body" to null, "caption" to null, "words" to read.words)
        }

    private fun shownOf(json: JsonObject): Map<String, Any?> =
        mapOf(
            "withheld" to json.getValue("withheld").jsonPrimitive.booleanOrNull,
            "body" to json.text("body"),
            "caption" to json.text("caption"),
            "words" to json.text("words"),
        )

    @Test
    fun `every held-read case shows the web's words`() {
        val cases = SheetParity.cases("weekRead")
        assertTrue(cases.size >= 25)
        cases.forEach { test ->
            val card =
                test.obj("card")?.let {
                    CardProjection(
                        it.getValue("week").jsonPrimitive.int,
                        it.string("scoring") == "ppr",
                        it["points"]?.jsonPrimitive?.doubleOrNull,
                        SheetParity.state(it.text("state")),
                    )
                }
            val read = SheetParity.readOf(test.getValue("read"))
            assertEquals(shownOf(test.getValue("shown").jsonObject), shown(WeekReads.shown(read, card)), test.string("name"))
        }
    }

    @Test
    fun `the newer of the run's and the live read is shown as the web shows it`() {
        val cases = SheetParity.cases("liveRead")
        assertTrue(cases.size >= 5)
        cases.forEach { test ->
            val name = test.string("name")
            val run = test.obj("run")?.let(SheetParity::readOf)
            val live =
                test.obj("live")?.let { CommishJson.decodeFromJsonElement(PlayerWeekRead.serializer(), it) }
            val answered = test.getValue("answered").jsonPrimitive.booleanOrNull == true
            val shown = WeekReads.newest(run, if (answered) live else null)
            val want = test.obj("shown")?.let(SheetParity::readOf)
            assertEquals(want?.body, shown?.body, name)
            assertEquals(want?.caption, shown?.caption, name)
            assertEquals(want?.writtenAt, shown?.writtenAt, name)
            assertEquals(want?.status, shown?.status, name)
            assertEquals(want?.call, shown?.call, name)
            assertEquals(want?.projection?.toDouble(), shown?.projection?.toDouble(), name)
            // The Proj change tile measures from the shown read's figure: a live read quoting none quotes none.
            if (shown != null && live != null && shown.writtenAt == live.writtenAt) {
                val quoted = shown.projection?.let { QuotedProjection.Points(it.toDouble()) } ?: QuotedProjection.None
                assertEquals(quoted, QuotedProjection.of(shown), name)
            }
        }
    }

    @Test
    fun `with no read the place names his next game only while it is to come`() {
        SheetParity.cases("noRead").forEach { test ->
            val due = test.obj("due")?.let { CommishJson.decodeFromJsonElement(RunReadsDue.serializer(), it) }
            // A case with no screen clock is the screen before it has read one: any instant before the nightly.
            val now = test.text("now")?.let(Instant::parse) ?: Instant.EPOCH
            assertEquals(
                test.string("words"),
                WeekReads.noRead(SheetParity.state(test.text("state")), due, now),
                "${test.text("state")} $due $now",
            )
        }
    }

    @Test
    fun `a read his status moved past is held as the web holds it`() {
        val cases = SheetParity.cases("statusHeld")
        assertTrue(cases.size >= 7)
        cases.forEach { test ->
            val built =
                StatusHeld.read(
                    SheetParity.readOf(test.getValue("read")),
                    SheetParity.captureOf(test["capture"]),
                    test.string("id"),
                    Instant.parse(test.string("now")),
                )
            val expected = SheetParity.readOf(test.getValue("built"))
            val name = test.string("name")
            assertEquals(expected.body, built.body, name)
            assertEquals(expected.caption, built.caption, name)
            assertEquals(expected.call, built.call, name)
        }
    }

    @Test
    fun `the next hourly pass follows the capture's schedule`() {
        SheetParity.cases("nextPass").forEach { pass ->
            val after = Instant.parse(pass.string("after"))
            assertEquals(Instant.parse(pass.string("at")), StatusHeld.nextHourlyPass(after), "$after")
        }
    }

    @Test
    fun `each sheet prints what the shelf prints`() {
        val sheets = SheetParity.cases("sheets")
        assertTrue(sheets.size >= 20)
        sheets.forEach { sheet ->
            val player = sheet.string("player")
            val clock = Instant.parse(sheet.string("clock"))
            val league = sheet.getValue("league").jsonPrimitive.booleanOrNull == true
            val formatOf = sheet.getValue("format").jsonObject
            val run = SheetParity.run(formatOf.string("run"))
            val format =
                SheetParity
                    .manifest(run)
                    .manifest.formats
                    .first { it.id == formatOf.string("id") }
            val week = if (league) WeekFixture.league(player, clock) else WeekFixture.publicWeek(player, clock)
            val card =
                PlayerCards.card(
                    CardInput(
                        week,
                        RunFixture.StandIn.page(player),
                        format,
                        SheetParity.capture(RunFixture.StandIn),
                        league,
                        SheetParity.zone,
                        clock,
                    ),
                )
            val name = "$player at $clock${if (league) "" else " with no league"} on ${formatOf.string("run")}"
            val head = sheet.getValue("head").jsonObject
            assertEquals(CardHead(head.getValue("week").jsonPrimitive.int, head.string("opponent")), card.head, name)
            assertEquals(sheet.obj("cell")?.let(::cellOf), card.cell?.let(::cell), name)
            assertEquals(sheet.getValue("tiles").jsonArray.map { tileOf(it.jsonObject) }, card.tiles.map(::tile), name)
            assertEquals(sheet.getValue("basis").jsonArray.map { it.jsonPrimitive.content }, card.basis, name)
            assertEquals(readOf(sheet.getValue("read").jsonObject), card.read?.let(::read), name)
        }
    }

    private fun cell(cell: NextCell): List<String?> = listOf(cell.place, cell.time, cell.expected, cell.weather?.glyph, cell.weather?.words)

    private fun cellOf(json: JsonObject): List<String?> {
        val weather = json.obj("weather")
        return listOf(json.string("where"), json.string("when"), json.text("expected"), weather?.text("glyph"), weather?.text("words"))
    }

    private fun read(read: SheetRead): Map<String, Any?> =
        when (read) {
            is SheetRead.None -> mapOf("written" to false, "withheld" to null, "body" to null, "caption" to null, "words" to read.words)
            is SheetRead.Shown -> mapOf("written" to true) + shown(read.read)
        }

    private fun readOf(json: JsonObject): Map<String, Any?> =
        mapOf(
            "written" to json.getValue("written").jsonPrimitive.booleanOrNull,
            "withheld" to json["withheld"]?.takeIf { it != JsonNull }?.jsonPrimitive?.booleanOrNull,
            "body" to json.text("body"),
            "caption" to json.text("caption"),
            "words" to json.text("words"),
        )
}

internal fun tile(tile: CardTile): List<String?> = listOf(tile.key.id, tile.label, tile.value, tile.tone?.id)

internal fun tileOf(json: JsonObject): List<String?> =
    listOf(json.string("key"), json.string("label"), json.string("value"), json.text("tone"))
