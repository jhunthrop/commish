package app.trycommish.core.start

import app.trycommish.api.CommishJson
import app.trycommish.api.models.HostMoveResult
import app.trycommish.api.models.LeagueHost
import app.trycommish.core.leaguehome.Fixtures
import app.trycommish.core.leaguehome.ValueWords
import app.trycommish.design.Words
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.MethodSource

/**
 * The Start screen's port held to the web's Lineup at 390 (shared/fixtures/parity/lineup.json), as the
 * iOS port is: the strip, every row's cells, the Team row, the pinned verb and its line, the copied
 * lineup, the move's changes and the phone's basis at all six fixture clocks, the same answers with
 * ESPN's writes open, and the move's words per platform with each outcome.
 */
class StartParityTest {
    private val parity: JsonObject = CommishJson.parseToJsonElement(StartFixtures.parity()).jsonObject

    private fun web(
        clock: String,
        writes: Boolean,
    ): JsonObject =
        parity
            .getValue(if (writes) "writes" else "clocks")
            .jsonObject
            .getValue(clock)
            .jsonObject

    private fun model(
        clock: String,
        writes: Boolean,
    ): StartModel {
        val advice = if (writes) StartFixtures.writes(clock) else StartFixtures.lineup(clock)
        val host = if (writes) LeagueHost.espn else LeagueHost.ffpc
        return startModel(advice, host, StartFixtures.instant(clock), Fixtures.zone)
    }

    @ParameterizedTest
    @MethodSource("clocks")
    fun `the strip is the web's`(clock: String) {
        val web = web(clock, writes = false)
        val model = model(clock, writes = false)
        assertEquals("Week ${web.int("week")}", model.week)
        assertEquals(web.text("title"), model.title)
        assertEquals(web.text("decision"), model.decision)
        val sum = web["sum"]?.takeUnless { it is JsonNull }?.jsonObject
        assertEquals(
            sum?.let { listOf(it.text("figure"), it.text("words"), it.text("gain"), it.text("final")) },
            model.sum?.let { listOf(it.figure, it.words, it.gain, it.final) },
        )
        assertEquals(web.text("done"), model.done)
        assertEquals(web.text("missed"), model.missed)
        val shown = web.getValue("chipsShown").jsonPrimitive.boolean
        val idle = model.chips.filterIsInstance<StripChip.Idle>().map { it.words }
        val swaps = model.chips.filterIsInstance<StripChip.SwapChip>().map { StartWords.swap(it.swap) }
        assertEquals(if (shown) web.strings("idle") else emptyList<String>(), idle)
        assertEquals(if (shown) web.getValue("swaps").jsonArray.map { it.jsonObject.text("words") } else emptyList<String>(), swaps)
    }

    @ParameterizedTest
    @MethodSource("clocks")
    fun `every row is the web's`(clock: String) {
        val web = web(clock, writes = false)
        val model = model(clock, writes = false)
        assertEquals(web.rows("starters"), model.starters.map(::rowOf))
        assertEquals(web.rows("bench"), model.bench.map(::rowOf))
        assertEquals(web.rows("reserve"), model.reserve.map(::rowOf))
        assertEquals(web.strings("empty"), model.empty)
        val team = web.getValue("team").jsonObject
        assertEquals(
            TeamRow(
                team.text("note"),
                team.getValue("live").jsonPrimitive.boolean,
                team.text("caption"),
                team.text("proj").orEmpty(),
                team.text("pts").orEmpty(),
            ),
            model.team,
        )
    }

    @ParameterizedTest
    @MethodSource("clocks")
    fun `the basis is the web's phone paragraph`(clock: String) {
        assertEquals(web(clock, writes = false).text("basis"), model(clock, writes = false).basis)
    }

    @ParameterizedTest
    @MethodSource("clocks")
    fun `the verb, its line, the move and the copy are the web's`(clock: String) {
        listOf(false, true).forEach { writes ->
            val web = web(clock, writes)
            val model = model(clock, writes)
            val pinned = web.getValue("pinned").jsonObject
            val label = "$clock writes $writes"
            assertEquals(pinned.text("verb"), model.verb?.title, label)
            val lines = listOfNotNull(pinned.text("page"), pinned.text("line")?.takeIf { it.isNotEmpty() })
            assertEquals(lines, model.foot.map { line -> line.joinToString("") { it.text } }, label)
            val changes =
                web
                    .getValue(
                        "changes",
                    ).jsonArray
                    .map { it.jsonObject }
                    .map { listOf(it.text("slot"), it.text("in"), it.text("out")) }
            assertEquals(changes, model.move.changes.map { listOf(it.slot.value, it.`in`, it.out) }, label)
            assertEquals(web.text("copy"), model.copyText, label)
            val copied = web.getValue("copied").jsonObject
            assertEquals(
                listOf("${copied.text("said")} ${Words.Lineup.setItOn} ${copied.text("page")}."),
                model.copied(true).map { line -> line.joinToString("") { it.text } },
                label,
            )
        }
    }

    @Test
    fun `the move's words are the web's for every platform`() {
        parity.getValue("moves").jsonArray.map { it.jsonObject }.forEach { web ->
            val host = LeagueHost.entries.first { it.value == web.text("host") }
            val platform = ValueWords.platform(host)
            assertEquals(web.text("verb"), StartWords.setItOn(platform))
            assertEquals(web.text("reading"), StartWords.reading(platform))
            assertEquals(web.text("setting"), StartWords.setting(platform))
            assertEquals(web.text("open"), StartWords.open(platform))
            assertEquals(web.text("lost"), StartWords.lost(platform))
            web.getValue("results").jsonArray.map { it.jsonObject }.forEach { result ->
                val outcome = HostMoveResult.Outcome.entries.first { it.value == result.text("outcome") }
                val made =
                    HostMoveResult(
                        outcome,
                        result.text("sentence").orEmpty(),
                        result.text("hostWords"),
                        "https://example.test/lineup",
                        null,
                        null,
                    )
                val panel = requireNotNull(MovePanel.of(MoveStep.made(made), platform))
                assertEquals(result.text("words"), panel.line)
                assertEquals(result.text("said"), panel.said)
            }
        }
    }

    companion object {
        @JvmStatic
        fun clocks(): List<String> = StartFixtures.clocks
    }
}
