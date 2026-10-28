package app.trycommish.core.trades

import app.trycommish.api.models.PlayerLine
import app.trycommish.api.models.TradeAcceptable
import app.trycommish.api.models.TradeCheck
import app.trycommish.api.models.TradeFills
import app.trycommish.core.leaguehome.Fixtures
import app.trycommish.core.start.StartFixtures
import app.trycommish.core.start.int
import app.trycommish.core.start.rowOf
import app.trycommish.core.start.strings
import app.trycommish.core.start.text
import app.trycommish.design.Words
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.double
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/**
 * The Trades' picker, builder and built sentences held to the web (shared/fixtures/parity/trades.json,
 * Lane 189 fix round 1), as the iOS port is: every checkWords branch over the fixture's check edited as
 * builder.test.ts edits one, the decisions with no trade and with a gain under what a page shows, the
 * strip's titles (No, One, Two, 3), the builder's prompts, the Trades holding picker and its narrowed
 * rows, and the builder opened from the best trade with its check (both rosters with their ticks, the
 * answer line, the pin).
 */
class TradesBuilderParityTest {
    private val parity = TradesParity.file
    private val words = parity.getValue("words").jsonObject
    private val week = StartFixtures.instant(TradeFixtures.WEEK)

    private fun JsonObject.flag(key: String): Boolean = getValue(key).jsonPrimitive.boolean

    private fun JsonObject.number(key: String): Double = getValue(key).jsonPrimitive.double

    private fun unfigured(line: PlayerLine): PlayerLine = line.copy(restOfSeasonPerGame = null)

    /** The fixture's check with an edit, as trades-parity.ts editedCheck makes it. */
    private fun edited(
        check: TradeCheck,
        edit: JsonObject,
    ): TradeCheck {
        val fills = edit.getValue("fills").jsonObject
        val trade = check.trade
        val perGame = edit.flag("perGame")
        // The edited check's acceptable and rest of season (Lane 277); null for an older answer.
        val acceptable = (edit.getValue("acceptable") as? JsonObject)?.let { TradeAcceptable(it.flag("yours"), it.flag("theirs")) }
        val rest = edit.getValue("rest") as? JsonObject
        return check.copy(
            acceptable = acceptable,
            fills =
                TradeFills(
                    yours = fills.flag("yours"),
                    theirs = fills.flag("theirs"),
                    yoursOpen = fills.text("yours_open"),
                    theirsOpen = fills.text("theirs_open"),
                    yoursRoom = fills.flag("yours_room"),
                    theirsRoom = fills.flag("theirs_room"),
                ),
            trade =
                trade.copy(
                    myGain = edit.number("myGain"),
                    theirGain = edit.number("theirGain"),
                    drop = if (edit.flag("keepDrop")) trade.drop else null,
                    dropReason = edit.text("dropReason"),
                    give = if (perGame) trade.give else trade.give.map(::unfigured),
                    get = if (perGame) trade.get else trade.get.map(::unfigured),
                    myRestOfSeason = rest?.number("yours"),
                    theirRestOfSeason = rest?.number("theirs"),
                ),
        )
    }

    @Test
    fun `every check sentence is the web's`() {
        val base = TradeFixtures.check()
        val checks = words.getValue("checks").jsonArray.map { it.jsonObject }
        assertEquals(22, checks.size)
        checks.forEach { edit ->
            val check = edited(base, edit)
            assertEquals(edit.text("sentence"), TradeChecks.words(check), edit.text("name"))
            assertEquals(edit.text("refusal"), TradeChecks.refusal(check), edit.text("name"))
        }
        // Lane 277: each side that would not take it leads its line.
        val refusals = checks.map { it.text("refusal") }
        assertTrue(Words.Trades.theyGiveUp in refusals)
        assertTrue(Words.Trades.youGiveUp in refusals)
        assertTrue(Words.Trades.bothGiveUp in refusals)
    }

    @Test
    fun `the decisions, titles and prompts are the web's`() {
        assertEquals(words.text("noTrade"), TradesWords.decision(null, ""))
        val row = TradeFixtures.check().trade.copy(myGain = 0.04, theirGain = 0.6, drop = null)
        assertEquals(words.text("under"), TradesWords.decision(row, "Max_Jensen10"))
        words.getValue("titles").jsonArray.map { it.jsonObject }.forEach {
            assertEquals(it.text("title"), TradesWords.worthTitle(it.int("count")))
        }
        assertEquals(words.text("noTradeWith"), TradesWords.noTradeWith("Josh Downs"))
        words.getValue("prompts").jsonArray.map { it.jsonObject }.forEach {
            val picks = TradePicks(1, List(it.int("give")) { n -> "g$n" }, List(it.int("get")) { n -> "t$n" })
            assertEquals(it.text("prompt"), TradeBuilder.prompt(picks))
        }
    }

    @Test
    fun `the picker and the trades holding a player are the web's`() {
        val web = parity.getValue("holding").jsonObject
        val advice = TradeFixtures.trades()
        val player = web.text("player")
        val model = { every: Boolean ->
            TradesModel(
                advice,
                TradeFixtures.holding(),
                player,
                TradesParity.host,
                TradesParity.me,
                every,
                TradeSort.Mine,
                week,
                Fixtures.zone,
            )
        }
        val best = model(false)
        // The web's key for a player our board does not place names the platform's id field; the app's
        // prefix is its own (TradeFinder.UNPLACED).
        val key = { text: String? -> text?.replace("host:", TradeFinder.UNPLACED) }
        val yours = web.getValue("yours").jsonArray.map { it.jsonObject }
        val theirs = web.getValue("theirs").jsonArray.map { it.jsonObject }
        assertEquals(yours.map { key(it.text("key")) }, best.picker.yours.map { it.key })
        assertEquals(yours.map { it.text("name") }, best.picker.yours.map { it.name })
        assertEquals(theirs.map { it.text("key") }, best.picker.theirs.map { it.key })
        assertEquals(web.text("decision"), best.decision)
        assertEquals(web.getValue("rows").jsonArray.map { TradesParity.row(it.jsonObject) }, best.rows.map(TradesParity::row))
        assertEquals(web.getValue("every").jsonArray.map { TradesParity.row(it.jsonObject) }, model(true).rows.map(TradesParity::row))
        val unheld = web.getValue("unheld").jsonObject
        val none =
            TradesModel(advice, null, unheld.text("key"), TradesParity.host, TradesParity.me, false, TradeSort.Mine, week, Fixtures.zone)
        assertEquals(unheld.text("decision"), none.decision)
        assertTrue(none.noneHolding)
        assertNull(none.strip)
        assertTrue(none.rows.isEmpty())
    }

    private fun pickWord(tick: PickTick): String =
        when (tick) {
            PickTick.Picked -> "on"
            is PickTick.Open -> if (tick.disabled) "off-full" else "off"
            PickTick.None -> "no"
            PickTick.Drop -> "drop"
        }

    private fun box(web: JsonObject): List<Any?> =
        listOf(
            web.text("team"),
            web.text("holds"),
            web.getValue("rows").jsonArray.map {
                val row = it.jsonObject
                rowOf(row) + listOf(row.text("season"), row.text("line"), row.text("pick"))
            },
        )

    private fun box(box: BuilderBox): List<Any?> =
        listOf(box.team, box.holds, box.rows.map { rowOf(it.cells) + listOf(it.cells.season, it.line, pickWord(it.tick)) })

    @Test
    fun `the builder from the best trade is the web's`() {
        val web = parity.getValue("builder").jsonObject
        val webPicks = web.getValue("picks").jsonObject
        val picks = TradePicks(webPicks.int("team"), webPicks.strings("give"), webPicks.strings("get"))
        val model =
            TradeBuilder.model(
                TradeBuilder.Inputs(
                    advice = TradeFinder.held(TradeFixtures.trades(), week),
                    picks = picks,
                    answer = TradeFixtures.check(),
                    problem = null,
                    me = TradeMe(TradesParity.me, ""),
                    pageKnown = true,
                    zone = Fixtures.zone,
                    now = week,
                ),
            )
        val teams = web.getValue("teams").jsonArray.map { it.jsonObject }
        assertEquals(teams.map { it.int("rosterId") }, model.teams.map { it.id })
        assertEquals(teams.map { it.text("choice") }, model.teams.map { it.choice })
        assertEquals(web.text("sentence"), model.sentence)
        assertEquals(web.text("close"), model.close)
        assertEquals(web.text("own"), model.own)
        assertEquals(box(web.getValue("yours").jsonObject), box(model.yours))
        val theirs = requireNotNull(model.theirs)
        val webTheirs = web.getValue("theirs").jsonObject
        assertEquals(box(webTheirs), box(theirs))
        assertEquals(webTheirs.text("aside"), theirs.aside)
        val pin = model.pin as BuilderPinWords.Gains
        assertEquals(web.text("pin"), "${pin.mine} ${pin.rest}")
        assertTrue(model.verbEnabled)
        assertTrue(web["close"] is JsonNull)
    }
}
