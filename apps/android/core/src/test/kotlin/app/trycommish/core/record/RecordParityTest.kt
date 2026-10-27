package app.trycommish.core.record

import app.trycommish.api.CommishJson
import app.trycommish.api.decodeEnvelope
import app.trycommish.api.models.RunRecordAnswer
import app.trycommish.api.models.RunScheduleAnswer
import app.trycommish.core.AppWords
import app.trycommish.core.rankings.RankingsFixtures
import app.trycommish.core.rankings.RecordFixture
import app.trycommish.core.start.strings
import app.trycommish.core.start.text
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.ValueSource
import java.time.Instant

/**
 * The Our record port held to the web's record page at 390 (shared/fixtures/parity/record.json, Lane
 * 194's file), as the iOS port is: the lead, the summary (the bug's tiles and pairs, the pending week and
 * when it grades, or the headline) with its gaps and honest sentence, the chips, the line before the
 * weeks, every week line with its status words, its order, its caption, its cells at every position and
 * figure and its ESPN sentence, the season to date, the phone's basis, and the draft record; for the
 * contract run's own record on Sunday and the Thursday after, and for the two records before week 7 is set
 * and after it is graded. The record never claims a weekly model.
 */
class RecordParityTest {
    private val parity: JsonObject = CommishJson.parseToJsonElement(RankingsFixtures.parity("record")).jsonObject

    private fun model(name: String): Pair<JsonObject, RecordModel> {
        val web =
            parity
                .getValue("cases")
                .jsonObject
                .getValue(name)
                .jsonObject
        val fixture = RecordFixture.of(web.text("file").orEmpty())
        val record = decodeEnvelope<RunRecordAnswer>(fixture.answer()).record
        val schedule = decodeEnvelope<RunScheduleAnswer>(RecordFixture.scheduleAnswer()).schedule
        return web to recordModel(record, schedule, web.text("scoring").orEmpty(), Instant.parse(web.text("now")))
    }

    @ParameterizedTest
    @ValueSource(strings = ["own-sunday", "own", "waiting", "upcoming", "graded", "published"])
    fun `the lead and the summary are the web's`(name: String) {
        val (web, model) = model(name)
        val weekly = web.getValue("weekly").jsonObject
        assertEquals(AppWords.record, model.title)
        assertEquals(web.text("lead"), model.lead)
        assertEquals(normalized(weekly.getValue("bug")), bugOf(model.weekly.bug))
        val head = weekly["head"] as? JsonObject
        assertEquals(head?.let { it.text("title") to it.text("what") }, model.weekly.head)
    }

    @ParameterizedTest
    @ValueSource(strings = ["own-sunday", "own", "waiting", "upcoming", "graded", "published"])
    fun `the weeks are the web's with their status words`(name: String) {
        val (web, model) = model(name)
        val weekly = web.getValue("weekly").jsonObject
        val section = model.weekly
        assertEquals(weekly.strings("positions"), section.positions)
        assertEquals(weekly.strings("figures"), section.figures)
        assertEquals(weekly.strings("sourceHeads"), section.sourceHeads)
        val before = weekly["before"] as? JsonObject
        assertEquals(before?.let { it.text("lead") to it.text("text") }, section.before)
        assertEquals(weekly.getValue("rows").jsonArray.map { rowOf(it.jsonObject) }, section.rows.map(::rowOf))
        assertEquals((weekly["toDate"] as? JsonObject)?.let(::toDateOf), section.toDate?.let(::toDateOf))
        assertEquals(weekly.text("basis"), section.basis)
    }

    @ParameterizedTest
    @ValueSource(strings = ["own-sunday", "own", "waiting", "upcoming", "graded", "published"])
    fun `the draft record is the web's`(name: String) {
        val (web, model) = model(name)
        val theirs = web.getValue("draft").jsonObject
        val draft = model.draft
        val head = theirs.getValue("head").jsonObject
        assertEquals(head.text("title"), draft.title)
        assertEquals(head.text("what"), draft.what)
        assertEquals(theirs.text("waiting"), draft.waiting)
        if (theirs.text("waiting") != null) return
        val bug = theirs["bug"] as? JsonObject
        assertEquals(bug?.text("span"), draft.span)
        assertEquals(bug?.text("players"), draft.players)
        assertEquals(
            bug?.getValue("tiles")?.jsonArray?.map { tile ->
                val t = tile.jsonObject
                listOf(t.text("label"), t.text("key"), pairOf(t.getValue("pair").jsonObject))
            },
            draft.tiles.map { listOf(it.label, it.key, pairOf(it.pair)) },
        )
        assertEquals(bug?.text("honest"), draft.honest)
        assertEquals(theirs.strings("figures"), draft.figures)
        assertEquals(theirs.getValue("rows").jsonArray.map { draftRowOf(it.jsonObject) }, draft.rows.map(::draftRowOf))
        assertEquals((theirs["all"] as? JsonObject)?.let(::draftRowOf), draft.all?.let(::draftRowOf))
        assertEquals(theirs.text("basis"), draft.basis)
    }

    @ParameterizedTest
    @ValueSource(strings = ["own-sunday", "own", "waiting", "upcoming", "graded", "published"])
    fun `the record never claims a weekly model`(name: String) {
        val (_, model) = model(name)
        val said = listOf(model.lead, model.weekly.basis, model.draft.basis) + model.weekly.rows.map { it.text }
        assertFalse(said.any { it.contains("model", ignoreCase = true) })
    }

    // The parity file's shapes, and the port's in the same shapes.

    /** The web's bug with its null fields and the cells' source names left out, as the port carries them. */
    private fun normalized(bug: JsonElement): Any? =
        when (bug) {
            is JsonObject -> bug.filterKeys { it != "source" }.filterValues { it !is JsonNull }.mapValues { normalized(it.value) }
            is JsonArray -> bug.map(::normalized)
            is JsonPrimitive -> bug.content
            JsonNull -> null
        }

    private fun bugOf(bug: RecordBug): Any? =
        when (bug) {
            is RecordBug.Tiles ->
                mapOf(
                    "kind" to "tiles",
                    "standing" to bug.standing,
                    "head" to bug.head,
                    "tiles" to bug.tiles.map(::tileOf),
                    "gaps" to bug.gaps,
                    "honest" to bug.honest,
                ).filterValues { it != null }
            is RecordBug.Pending -> mapOf("kind" to "pending", "title" to bug.title, "when" to bug.whenSaid, "gaps" to bug.gaps)
            is RecordBug.Headline -> mapOf("kind" to "headline", "value" to bug.value, "caption" to bug.caption, "gaps" to bug.gaps)
        }

    private fun tileOf(tile: RecordTile): Map<String, Any?> =
        mapOf(
            "label" to tile.label,
            "pairs" to tile.pairs?.map(::pairMapOf),
            "values" to
                tile.ours?.let { ours ->
                    mapOf(
                        "ours" to ours,
                        "beside" to
                            tile.beside.map {
                                mapOf("head" to it.head, "value" to it.value, "ours" to it.ours).filterValues { v ->
                                    v != null
                                }
                            },
                    )
                },
        ).filterValues { it != null }

    private fun pairMapOf(pair: FigurePair): Map<String, Any?> =
        mapOf(
            "ours" to pair.ours,
            "theirs" to pair.theirs,
            "name" to pair.name,
            "leader" to pair.leader?.word,
            "lead" to pair.lead,
            "accented" to pair.accented.toString(),
        ).filterValues { it != null }

    private fun pairOf(pair: JsonObject): List<Any?> =
        listOf(
            pair.text("ours"),
            pair.text("theirs"),
            pair.text("name"),
            pair.text("leader"),
            pair.text("lead"),
            pair.getValue("accented").jsonPrimitive.boolean,
        )

    private fun pairOf(pair: FigurePair): List<Any?> =
        listOf(pair.ours, pair.theirs, pair.name, pair.leader?.word, pair.lead, pair.accented)

    private fun cellsOf(cells: JsonObject?): Map<String, Map<String, List<Any?>>>? =
        cells?.mapValues { (_, figures) ->
            figures.jsonObject.mapValues { (_, figure) ->
                val f = figure.jsonObject
                listOf(
                    f.getValue("trails").jsonPrimitive.boolean,
                    f.getValue("cells").jsonArray.map { cell -> cell.jsonObject.let { listOf(it.text("value"), it.text("same")) } },
                )
            }
        }

    private fun cellsOf(cells: RecordCells?): Map<String, Map<String, List<Any?>>>? =
        cells?.mapValues { (_, figures) ->
            figures.entries.associate { (figure, shown) ->
                figure.key to listOf(shown.trails, shown.cells.map { listOf(it.value, it.same) })
            }
        }

    private fun rowOf(row: JsonObject): List<Any?> =
        listOf(
            row.text("lead"),
            row.text("text"),
            row.text("order"),
            row.text("caption"),
            row.getValue("graded").jsonPrimitive.boolean,
            row.text("players"),
            cellsOf(row["cells"] as? JsonObject),
            row.text("note"),
        )

    private fun rowOf(row: RecordRow): List<Any?> =
        listOf(row.lead, row.text, row.order, row.caption, row.graded, row.players, cellsOf(row.cells), row.note)

    private fun toDateOf(row: JsonObject): List<Any?> =
        listOf(row.text("lead"), row.text("players"), cellsOf(row.getValue("cells").jsonObject))

    private fun toDateOf(row: RecordToDate): List<Any?> = listOf(row.lead, row.players, cellsOf(row.cells))

    private fun draftRowOf(row: JsonObject): List<Any?> =
        listOf(
            row.text("position"),
            row.getValue("players").jsonPrimitive.int,
            row.getValue("cells").jsonObject.mapValues { (_, cell) ->
                val c = cell.jsonObject
                listOf(c.getValue("accented").jsonPrimitive.boolean, c.strings("cells"))
            },
        )

    private fun draftRowOf(row: DraftRow): List<Any?> =
        listOf(
            row.position,
            row.players,
            row.cells.entries.associate { (figure, cell) ->
                figure.key to
                    listOf(cell.accented, listOf(cell.ours, cell.adp))
            },
        )
}
