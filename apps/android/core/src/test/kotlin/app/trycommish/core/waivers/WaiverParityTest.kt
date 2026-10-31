package app.trycommish.core.waivers

import app.trycommish.api.CommishJson
import app.trycommish.api.decodeEnvelope
import app.trycommish.api.models.HostBid
import app.trycommish.api.models.HostMoveResult
import app.trycommish.api.models.LeagueHost
import app.trycommish.api.models.WaiverAdvice
import app.trycommish.core.leaguehome.Fixtures
import app.trycommish.core.leaguehome.ValueWords
import app.trycommish.core.start.MoveKind
import app.trycommish.core.start.StartFixtures
import app.trycommish.core.start.StartWords
import app.trycommish.core.start.gameOf
import app.trycommish.core.start.int
import app.trycommish.core.start.rowOf
import app.trycommish.core.start.strings
import app.trycommish.core.start.text
import app.trycommish.design.Words
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.MethodSource

/**
 * The Waivers port held to the web's Waivers at 390 (shared/fixtures/parity/waivers.json, Lane 186's file),
 * as the iOS port is: the strip, the line under the heads, every row's cells and Beats cell in the
 * table's order, each row's verb, the drop panels, the pinned verb with its line, the arrival line and
 * the phone's basis at all six fixture clocks on the FFPC stand-in and at the week's clock on each ESPN
 * stand-in; the claim's words for every platform, each outcome, the bid's label and its problems; the
 * D/ST chip's read over the page's answer; the Stash group and a clearing day over stash.test.ts's
 * inputs; every screen's chips, sorts and searches.
 */
class WaiverParityTest {
    internal val parity: JsonObject = CommishJson.parseToJsonElement(WaiverFixtures.parity()).jsonObject

    private fun section(name: String): JsonObject = parity.getValue(name).jsonObject

    internal fun web(name: String): JsonObject =
        section("clocks")[name]?.jsonObject
            ?: section("espn")[name]?.jsonObject?.getValue("screen")?.jsonObject
            ?: section("narrowed")[name]?.jsonObject
            ?: section("stashed")
                .getValue(name)
                .jsonObject
                .getValue("screen")
                .jsonObject

    /** A synthetic answer the parity file carries (the Stash cases), read as the API sends it. */
    private fun synthetic(name: String): WaiverAdvice {
        val advice = section("stashed").getValue(name).jsonObject.getValue("advice")
        return decodeEnvelope("""{"ok":true,"data":$advice,"error":null}""")
    }

    internal fun model(name: String): WaiverModel {
        val week = StartFixtures.instant(WaiverFixtures.WEEK)
        val ffpc = Fixtures.sync().host
        if (section("narrowed").containsKey(name)) {
            val shown = decodeEnvelope<WaiverAdvice>(WaiverFixtures.body(WaiverFixtures.FFPC, "$name-${WaiverFixtures.WEEK}"))
            return WaiverModel(WaiverFixtures.waivers(WaiverFixtures.FFPC), shown, ffpc, week, Fixtures.zone)
        }
        if (section("stashed").containsKey(name)) return WaiverModel(synthetic(name), null, ffpc, week, Fixtures.zone)
        section("espn")[name]?.jsonObject?.let { espn ->
            val clock = parity.text("espnClock").orEmpty()
            val advice = WaiverFixtures.waivers(espn.text("id").orEmpty(), clock)
            return WaiverModel(advice, null, LeagueHost.espn, StartFixtures.instant(clock), Fixtures.zone)
        }
        return WaiverModel(WaiverFixtures.waivers(WaiverFixtures.FFPC, name), null, ffpc, StartFixtures.instant(name), Fixtures.zone)
    }

    internal fun JsonObject.obj(key: String): JsonObject? = get(key)?.takeUnless { it is JsonNull }?.jsonObject

    private fun JsonObject.flag(key: String): Boolean = getValue(key).jsonPrimitive.boolean

    /** A row as the web's JSON writes it: the box row's cells the Lineup's parity holds, then the Waivers'
     * own. */
    private fun webRow(row: JsonObject): List<Any?> {
        val beats = row.getValue("beats").jsonObject
        return listOf(
            row.text("key"),
            row.text("name"),
            row.text("fit"),
            row.text("slug"),
            row.text("club"),
            row.text("position"),
            row.obj("status")?.let { listOf(it.text("mark"), it.flag("sits")) },
            row.text("rank"),
            gameOf(row["game"]),
            row.text("proj"),
            row.text("evidence"),
            row.text("oppRank"),
            row.text("ease"),
            row.text("state"),
            row.text("rest"),
            row.text("clears"),
            row.text("away"),
            row.flag("named"),
            row.flag("gains"),
            listOf(
                beats.obj("who")?.let { listOf(it.text("name"), it.text("place")) },
                beats.text("figure"),
                beats.flag("loud"),
                beats.text("week"),
            ),
            row.text("button"),
            row.flag("opensPage"),
            row.text("verb"),
            row.flag("claimsHere"),
        )
    }

    /** The same from the port. */
    private fun portRow(
        pool: PoolRow,
        model: WaiverModel,
    ): List<Any?> {
        val cells = pool.cells
        val row = cells.row
        val beats = pool.beats
        val rest = if (pool.stash == null) pool.source.add.restOfSeasonPerGame else pool.source.stash?.perGame
        return listOf(
            pool.key,
            row.name,
            row.fit,
            row.slug,
            row.club,
            row.position,
            row.status?.let { listOf(it.mark, it.sits) },
            cells.rank,
            rowOf(cells)[GAME_CELL],
            cells.proj,
            pool.evidence,
            cells.oppRank,
            cells.ease.word,
            row.read.stateName,
            StartWords.number(rest),
            pool.clears,
            pool.away,
            pool.named,
            pool.gains,
            listOf(beats.who?.let { listOf(it.name, it.place) }, beats.figure, beats.loud, beats.week),
            pool.button,
            pool.opensPage,
            model.verb(pool.source),
            model.claimsHere(pool.source),
        )
    }

    private fun rows(
        web: JsonObject,
        key: String,
    ): List<List<Any?>> = web.getValue(key).jsonArray.map { webRow(it.jsonObject) }

    private fun keys(element: JsonElement?): List<String> = element?.jsonArray?.map { it.jsonPrimitive.content }.orEmpty()

    @ParameterizedTest
    @MethodSource("screens")
    fun `the strip is the web's`(name: String) {
        val web = web(name)
        val model = model(name)
        assertEquals("Week ${web.int("week")}", model.week)
        assertEquals(web.text("title"), model.title)
        assertEquals(web.text("decision"), model.decision)
        assertEquals(
            web.obj("sum")?.let { listOf(it.text("figure"), it.text("words"), it.text("gain")) },
            model.sum?.let { listOf(it.figure, it.words, it.gain) },
        )
        assertEquals(
            web.getValue("cards").jsonArray.map { it.jsonObject }.map {
                listOf(it.text("key"), it.text("slot"), it.text("mark"), it.text("move"), it.text("why"), it.text("gains"), it.text("verb"))
            },
            model.cards.map { listOf(it.key, it.slot, it.mark, it.move, it.why, it.gains, it.verb) },
        )
    }

    @ParameterizedTest
    @MethodSource("screens")
    fun `the heads, the rows and their groups are the web's`(name: String) {
        val web = web(name)
        val model = model(name)
        val table = model.table()
        assertEquals(web.flag("projected"), model.projected)
        assertEquals(web.text("arrives"), model.arrives)
        assertEquals(web.text("heads"), model.heads)
        assertEquals(rows(web, "gaining"), table.gaining.map { portRow(it, model) })
        assertEquals(rows(web, "rest"), table.rest.map { portRow(it, model) })
        assertEquals(rows(web, "stash"), table.stash.map { portRow(it, model) })
        assertEquals(web.strings("stashLine"), model.stashLine)
    }

    @ParameterizedTest
    @MethodSource("screens")
    fun `every drop panel is the web's`(name: String) {
        val web = web(name)
        val model = model(name)
        val panels = web.getValue("drops").jsonObject
        assertFalse(panels.isEmpty())
        panels.forEach { (key, value) ->
            val panel = value.jsonObject
            val row = requireNotNull(model.rows.firstOrNull { it.key == key }) { key }
            val drops = model.drops(row)
            val head = model.dropHead(row)
            assertEquals(panel.text("title"), head.title)
            assertEquals(panel.text("lead"), head.lead)
            val webDrops = panel.getValue("rows").jsonArray.map { it.jsonObject }
            assertEquals(
                webDrops.map { listOf(it.text("key"), it.text("evidence"), it.text("gain"), it.text("week"), it.text("starter")) },
                drops.map { listOf(it.key, it.evidence, it.gain, it.week, it.starter) },
            )
            assertEquals(webDrops.map { rowOf(it.getValue("cells").jsonObject) }, drops.map { rowOf(it.cells) }, "$name $key")
            assertEquals(panel.text("pair"), model.pairWords(row.source, drops.firstOrNull()))
        }
    }

    @ParameterizedTest
    @MethodSource("screens")
    fun `the pinned verb, its line and the basis are the web's`(name: String) {
        val web = web(name)
        val model = model(name)
        val pinned = web.getValue("pinned").jsonObject
        assertEquals(pinned.text("verb"), model.cards.firstOrNull()?.let { model.verb(it.source) })
        assertEquals(pinned.text("line"), model.line)
        assertEquals(pinned.text("url"), model.page.orEmpty())
        assertEquals(web.text("basis"), model.basis)
        val card = model.cards.firstOrNull() ?: return
        val copied = web.obj("copied") ?: return
        val failed = requireNotNull(web.obj("copyFailed"))
        val said = WaiverWords.copied(model.platform, model.shortName(card.source), didCopy = true)
        val not = WaiverWords.copied(model.platform, model.shortName(card.source), didCopy = false)
        assertEquals(listOf(copied.text("said"), copied.text("page")), listOf(said.said, said.page))
        assertEquals(listOf(failed.text("said"), failed.text("page")), listOf(not.said, not.page))
    }

    @ParameterizedTest
    @MethodSource("screens")
    fun `the chips, every sort and every search are the web's`(name: String) {
        val web = web(name)
        val model = model(name)
        assertEquals(
            web
                .getValue("positions")
                .jsonArray
                .map { it.jsonObject }
                .map { listOf(it.text("position"), it.text("word")) },
            model.positions.map { listOf(it.position.query, it.word) },
        )
        web.getValue("sorts").jsonArray.map { it.jsonObject }.forEach { sort ->
            val key = requireNotNull(WaiverSortKey.of(sort.text("key").orEmpty()))
            val table = model.table(WaiverSort(key, sort.flag("down")))
            val said = "$name ${sort.text("key")} ${sort.flag("down")}"
            assertEquals(keys(sort["gaining"]), table.gaining.map { it.key }, said)
            assertEquals(keys(sort["rest"]), table.rest.map { it.key }, said)
            assertEquals(keys(sort["stash"]), table.stash.map { it.key }, said)
        }
        web.getValue("finds").jsonArray.map { it.jsonObject }.forEach { find ->
            val table = model.table(query = find.text("query").orEmpty())
            assertEquals(
                listOf(keys(find["gaining"]), keys(find["rest"]), keys(find["stash"])),
                listOf(table.gaining.map { it.key }, table.rest.map { it.key }, table.stash.map { it.key }),
                "$name ${find.text("query")}",
            )
        }
        assertEquals(web.text("empty"), Words.Waivers.noneFound)
    }

    @Test
    fun `each head chosen in turn sorts as the web's`() {
        val chosen =
            listOf(WaiverSortKey.Name, WaiverSortKey.Name, WaiverSortKey.Proj, WaiverSortKey.Proj, WaiverSortKey.Beats, WaiverSortKey.Game)
        val steps = chosen.runningFold(WaiverSort.Initial) { sort, key -> sort.next(key) }.drop(1)
        val web =
            parity
                .getValue("sortSteps")
                .jsonArray
                .map { it.jsonObject }
                .map { it.text("key") to it.flag("down") }
        assertEquals(web, steps.map { it.key.key to it.down })
    }

    @Test
    fun `the Stash cases hold each verb and a clearing day`() {
        val slot = web("withSlot")
        val stash = slot.getValue("stash").jsonArray.map { it.jsonObject }
        assertEquals(listOf("Stash", "Add"), stash.map { it.text("button") })
        assertEquals("Clears Thu", stash.first().text("clears"))
        val pool = (slot.getValue("gaining").jsonArray + slot.getValue("rest").jsonArray).map { it.jsonObject }
        assertTrue(pool.any { it.text("clears") == "Clears Wed" })
        val open =
            web("benchOpen")
                .getValue("stash")
                .jsonArray
                .map { it.jsonObject }
                .first()
        assertTrue(open.flag("opensPage"))
        assertEquals(
            listOf("IR slot", "Open"),
            open
                .getValue("beats")
                .jsonObject
                .obj("who")
                ?.let { listOf(it.text("name"), it.text("place")) },
        )
        assertTrue(web("noSlot").getValue("stash").jsonArray.all { it.jsonObject.text("button") == "Add" })
        // And the port draws the same rows.
        assertEquals(listOf("Stash", "Add"), model("withSlot").table().stash.map { it.button })
        assertTrue(
            model("benchOpen")
                .table()
                .stash
                .first()
                .opensPage,
        )
    }

    @Test
    fun `every line of the table carries the API's game_state`() {
        screens().forEach { name ->
            val model = model(name)
            val lines = model.advice.rows.map { it.add } + model.advice.roster
            assertTrue(lines.all { it.gameState?.state != null }, name)
        }
    }

    @Test
    fun `the claim's words are the web's for every platform`() {
        val claim = section("claim")
        assertEquals(claim.text("title"), Words.Move.claimTitle)
        claim.getValue("hosts").jsonArray.map { it.jsonObject }.forEach { web ->
            val host = requireNotNull(LeagueHost.entries.firstOrNull { it.value == web.text("host") })
            val platform = ValueWords.platform(host)
            val kind = MoveKind.Claim(Fixtures.zone)
            assertEquals(web.text("verb"), kind.verb(platform))
            assertEquals(web.text("reading"), kind.reading(platform))
            assertEquals(web.text("setting"), kind.setting(platform))
            assertEquals(web.text("open"), StartWords.open(platform))
            assertEquals(web.text("lost"), kind.lost(platform))
            web.getValue("results").jsonArray.map { it.jsonObject }.forEach { result ->
                val made =
                    HostMoveResult(
                        outcome = requireNotNull(HostMoveResult.Outcome.entries.firstOrNull { it.value == result.text("outcome") }),
                        sentence = result.text("sentence").orEmpty(),
                        hostWords = result.text("hostWords"),
                        hostUrl = "",
                        moveId = null,
                        processesAt = result.text("processesAt"),
                    )
                assertEquals(result.text("words"), kind.result(platform, made))
                assertEquals(result.text("said"), result.text("hostWords")?.let { StartWords.platformSaid(platform, it) })
            }
            web.getValue("bids").jsonArray.map { it.jsonObject }.forEach { terms ->
                val bid = terms.getValue("bid").jsonObject
                val hostBid = HostBid(bid.int("amount"), bid.int("min"), bid.int("max"), bid.flag("left_known"))
                assertEquals(terms.text("label"), WaiverWords.bidLabel(hostBid))
                terms.getValue("problems").jsonArray.map { it.jsonObject }.forEach { problem ->
                    val typed = problem.text("typed").orEmpty()
                    assertEquals(problem.text("problem"), WaiverWords.bidProblem(platform, typed, hostBid), "${web.text("host")} $typed")
                }
            }
        }
    }

    @Test
    fun `a clearing day and a stash's week read as the web's`() {
        assertEquals("Clears Wed", WaiverWords.clears("2026-10-21"))
        assertEquals(null, WaiverWords.clears(null))
        assertEquals("Back week 9", WaiverWords.back(9, 7))
        assertEquals("Back this week", WaiverWords.back(7, 7))
        assertNotNull(model("DEF").table().rows.firstOrNull())
    }

    companion object {
        /** The game cell's place in the Lineup parity's row order (ParityRows.kt rowOf). */
        private const val GAME_CELL = 11

        /** Each screen the parity holds: the FFPC stand-in at each clock, each ESPN stand-in at the week's,
         * the D/ST chip's read, the Stash cases. */
        @JvmStatic
        fun screens(): List<String> = StartFixtures.clocks + listOf("done", "refused", "pending", "DEF", "withSlot", "noSlot", "benchOpen")
    }
}
