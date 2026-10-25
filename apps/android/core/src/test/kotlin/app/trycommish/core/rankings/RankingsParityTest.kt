package app.trycommish.core.rankings

import app.trycommish.api.CommishJson
import app.trycommish.api.decodeEnvelope
import app.trycommish.api.models.OrderAdvice
import app.trycommish.core.leaguehome.Fixtures
import app.trycommish.core.shell.SheetPlayer
import app.trycommish.core.start.RowGame
import app.trycommish.core.start.gameOf
import app.trycommish.core.start.strings
import app.trycommish.core.start.text
import app.trycommish.design.Words
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.ValueSource
import java.io.File
import java.time.Instant

/**
 * The Rankings port held to the web's Players page in season at 390 (shared/fixtures/parity/rankings.json,
 * Lane 194's file), as the iOS port is: the sentence under the page's name, the hits, the heads, every row
 * of our order in its section with its place, pill, game, folded line, week and Projected, Show more and
 * the phone's basis, at every chip, a search alone and inside a position, and on Sunday; then the kickers'
 * and defenses' week, its sections and heads, a search over it, the line when none matches, and its basis
 * with the rules our stats lack. Review Focus 4: every place is the API's rank under every filter.
 */
class RankingsParityTest {
    private val parity: JsonObject = CommishJson.parseToJsonElement(RankingsFixtures.parity("rankings")).jsonObject

    private fun web(
        section: String,
        name: String,
    ): JsonObject =
        parity
            .getValue(section)
            .jsonObject
            .getValue(name)
            .jsonObject

    private fun body(web: JsonObject): String = File(System.getProperty("fixtures"), "inseason/${web.text("file")}").readText()

    private fun order(name: String): Pair<JsonObject, RankingsModel> {
        val web = web("orders", name)
        val chip = web.text("chip")?.let { api -> RankingsChip.entries.first { it.api == api } }
        val model = rankingsModel(decodeEnvelope(body(web)), chip, web.text("q").orEmpty(), true, Fixtures.zone, instant(web))
        return web to model
    }

    private fun week(name: String): Pair<JsonObject, WeekRankingsModel> {
        val web = web("weeks", name)
        val position = WeekPosition.valueOf(web.text("position").orEmpty())
        val model = weekRankingsModel(decodeEnvelope(body(web)), position, web.text("q").orEmpty(), "PPR", Fixtures.zone, instant(web))
        return web to model
    }

    private fun instant(web: JsonObject): Instant = Instant.parse(web.text("clock"))

    @Test
    fun `the page is named as the web names it in season`() {
        val names = parity.getValue("names").jsonObject
        assertEquals(names.text("inSeason"), RankingsWords.name(true))
        assertEquals(names.text("before"), RankingsWords.name(false))
        assertEquals(parity.text("leadBefore"), RankingsWords.lead(inSeason = false, onWeekChip = false, week = null))
        assertEquals(parity.strings("chips"), listOf(Words.Order.every) + RankingsChip.entries.map { it.word })
    }

    @ParameterizedTest
    @ValueSource(strings = ["all", "QB", "RB", "WR", "TE", "search", "WR-search", "all-sunday"])
    fun `the order's head, hits, basis and Show more are the web's`(name: String) {
        val (web, model) = order(name)
        assertEquals(web.text("lead"), model.lead)
        assertEquals(web.text("hits"), model.hits)
        val heads = web.getValue("heads").jsonObject
        assertEquals(RankingsHeads(heads.text("rank").orEmpty(), heads.text("week").orEmpty(), heads.text("total").orEmpty()), model.heads)
        assertEquals(web.getValue("more").jsonPrimitive.boolean, model.more)
        assertEquals(web.text("basis"), model.basis)
    }

    @ParameterizedTest
    @ValueSource(strings = ["all", "QB", "RB", "WR", "TE", "search", "WR-search", "all-sunday"])
    fun `every row is the web's in its section`(name: String) {
        val (web, model) = order(name)
        val sections = web.getValue("sections").jsonArray.map { it.jsonObject }
        assertEquals(sections.map { it.text("head") }, model.sections.map { it.head })
        sections.zip(model.sections).forEach { (theirs, mine) ->
            val rows = theirs.getValue("rows").jsonArray.map { it.jsonObject }
            assertEquals(rows.map(::orderRowOf), mine.rows.map(::orderRowOf))
        }
    }

    /** Review Focus 4: the # cell is the API's rank under every filter, a search and a position among
     * them, never a place numbered again on the phone. */
    @ParameterizedTest
    @ValueSource(strings = ["all", "QB", "RB", "WR", "TE", "search", "WR-search", "all-sunday"])
    fun `every place is the API's rank under every filter`(name: String) {
        val (web, model) = order(name)
        val advice = decodeEnvelope<OrderAdvice>(body(web))
        assertEquals(advice.rows.map { it.rank }, model.rows.map { it.rank })
        model.rows.filter { !it.bye && it.player.status?.onList != true }.forEach { assertEquals(it.rank.toString(), it.place) }
    }

    @ParameterizedTest
    @ValueSource(strings = ["DEF", "K", "DEF-search", "K-none", "K-sunday"])
    fun `the week's rows, sections and basis are the web's`(name: String) {
        val (web, model) = week(name)
        assertEquals(web.text("heading"), model.heading)
        val status = web["status"] as? JsonObject
        assertEquals(status?.let { "${it.text("lead")} ${it.text("rest")}" }, model.status)
        assertEquals(web.getValue("proj").jsonPrimitive.boolean, model.proj)
        assertEquals(web.text("none"), model.none)
        assertEquals(web.text("basis"), model.basis)
        assertEquals(web.text("rules"), model.rules)
        val sections = web.getValue("sections").jsonArray.map { it.jsonObject }
        assertEquals(sections.map { it.text("head") }, model.sections.map { it.head })
        sections.zip(model.sections).forEach { (theirs, mine) ->
            val rows = theirs.getValue("rows").jsonArray.map { it.jsonObject }
            assertEquals(rows.map(::weekRowOf), mine.rows.map(::weekRowOf))
        }
    }

    @Test
    fun `a row opens the player sheet by his id where the site has his page`() {
        val (_, model) = order("all")
        val swift = model.rows.first()
        assertEquals(
            SheetPlayer("4259545", "d-andre-swift", "D'Andre Swift", "RB", "15", "CHI", swift.player.headshot),
            swift.player.sheetPlayer,
        )
        val (_, defenses) = week("DEF")
        assertTrue(defenses.rows.all { it.player.sheetPlayer == null }, "a defense has no page")
    }

    // The cells in one order, from the web's JSON and from the port.

    private fun playerOf(row: JsonObject): List<Any?> {
        val status = (row["status"] as? JsonObject)?.let { listOf(it.text("mark"), it.getValue("sits").jsonPrimitive.boolean) }
        val weather = (row["weather"] as? JsonObject)?.let { listOf(it.text("glyph"), it.text("words")) }
        return listOf(
            row.text("key"),
            row.text("name"),
            row.text("fit"),
            row.text("slug"),
            row.getValue("mark").jsonPrimitive.boolean,
            row.text("club"),
            row.text("pill"),
            status,
            gameOf(row["game"]),
            row.text("expected"),
            weather,
        )
    }

    private fun playerOf(player: RankingsPlayer): List<Any?> =
        listOf(
            player.key,
            player.name,
            player.fit,
            player.slug,
            player.clubMark,
            player.club,
            player.pill,
            player.status?.let { listOf(it.mark, it.sits) },
            when (val game = player.game) {
                is RowGame.Game -> listOf(game.place, game.time)
                RowGame.Bye -> "bye"
                RowGame.NoClub -> "no-club"
                RowGame.None -> null
            },
            player.expected,
            player.weather?.let { listOf(it.glyph, it.words) },
        )

    private fun orderRowOf(row: JsonObject): List<Any?> =
        playerOf(row) +
            listOf(
                row.getValue("rank").jsonPrimitive.int,
                row.text("place"),
                row.getValue("bye").jsonPrimitive.boolean,
                row.text("week"),
                row.text("total"),
                row.text("folded"),
            )

    private fun orderRowOf(row: RankingsRow): List<Any?> = playerOf(row.player) + listOf(row.rank, row.place, row.bye, row.week, row.total, row.folded)

    private fun weekRowOf(row: JsonObject): List<Any?> = playerOf(row) + listOf(row.text("proj"), row.text("folded"))

    private fun weekRowOf(row: WeekRankingsRow): List<Any?> = playerOf(row.player) + listOf(row.proj, row.folded)
}
