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
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/**
 * The Trades' builder and built sentences held to the web (shared/fixtures/parity/trades.json, Lane 189
 * fix round 1, Lane 277), as the iOS port is: every checkWords branch over the fixture's check edited as
 * builder.test.ts edits one with its refusal and cells, the builder's prompts, and the builder at the Best
 * idea's ticks with its check (both rosters with their ticks, the answer line, the pin), a refusal in the
 * pin, a stale answer, and no team chosen.
 */
class TradesBuilderParityTest {
    private val parity = TradesParity.file
    private val words = parity.getValue("words").jsonObject
    private val week = StartFixtures.instant(TradeFixtures.WEEK)

    private fun JsonObject.flag(key: String): Boolean = getValue(key).jsonPrimitive.boolean

    private fun JsonObject.number(key: String): Double = getValue(key).jsonPrimitive.double

    private fun webRest(web: JsonObject): List<String?> = listOf(web.text("text"), web.text("tone"), web.text("refuses"))

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
            val cells = edit.getValue("cells").jsonObject
            assertEquals(webRest(cells.getValue("yours").jsonObject), TradesParity.rest(TradeRest.of(check, true)), edit.text("name"))
            assertEquals(webRest(cells.getValue("theirs").jsonObject), TradesParity.rest(TradeRest.of(check, false)), edit.text("name"))
        }
        // Lane 277: each side that would not take it leads its line.
        val refusals = checks.map { it.text("refusal") }
        assertTrue(Words.Trades.theyGiveUp in refusals)
        assertTrue(Words.Trades.youGiveUp in refusals)
        assertTrue(Words.Trades.bothGiveUp in refusals)
    }

    @Test
    fun `the prompts are the web's`() {
        words.getValue("prompts").jsonArray.map { it.jsonObject }.forEach {
            val picks = TradePicks(1, List(it.int("give")) { n -> "g$n" }, List(it.int("get")) { n -> "t$n" })
            assertEquals(it.text("prompt"), TradeBuilder.prompt(picks))
        }
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
                rowOf(row) + listOf(row.text("season"), row.text("pick"))
            },
        )

    private fun box(box: BuilderBox): List<Any?> =
        listOf(box.team, box.holds, box.rows.map { rowOf(it.cells) + listOf(it.cells.season, pickWord(it.tick)) })

    private fun builder(
        picks: TradePicks,
        answer: TradeCheck?,
        answered: TradePicks?,
    ): TradeBuilderModel =
        TradeBuilder.model(
            TradeBuilder.Inputs(
                advice = TradeFinder.held(TradeFixtures.trades(), week),
                ideas = TradesParity.model(TradeFixtures.WEEK).ideas,
                allIdeas = false,
                picks = picks,
                answer = answer,
                answered = answered,
                problem = null,
                me = TradeMe(TradesParity.me, ""),
                pageKnown = true,
                zone = Fixtures.zone,
                now = week,
            ),
        )

    private fun webPicks(): TradePicks {
        val picks =
            parity
                .getValue("builder")
                .jsonObject
                .getValue("picks")
                .jsonObject
        return TradePicks(picks.int("team"), picks.strings("give"), picks.strings("get"))
    }

    /** The Best idea loads the web's builder picks, and the builder at them with its check is the web's:
     * the team choices, the answer line, both rosters with their ticks, the cells, the pin. */
    @Test
    fun `the Best idea loads the web's builder`() {
        val web = parity.getValue("builder").jsonObject
        val picks = webPicks()
        val best =
            (
                TradesParity
                    .model(TradeFixtures.WEEK)
                    .ideas.places
                    .first() as IdeaPlace.Idea
            ).preset
        assertTrue(best.picks.same(picks))
        val model = builder(picks, TradeFixtures.check(), picks)
        assertEquals(best.key, model.pressed)
        val teams = web.getValue("teams").jsonArray.map { it.jsonObject }
        assertEquals(teams.map { it.int("rosterId") }, model.teams.map { it.id })
        assertEquals(teams.map { it.text("choice") }, model.teams.map { it.choice })
        assertEquals(web.text("sentence"), model.sentence)
        assertEquals(web.text("close"), model.close)
        assertEquals(web.text("own"), model.own)
        val rest = web.getValue("rest").jsonObject
        assertEquals(webRest(rest.getValue("yours").jsonObject), TradesParity.rest(model.bug.yours.rest))
        assertEquals(webRest(rest.getValue("theirs").jsonObject), TradesParity.rest(model.bug.theirs.rest))
        assertEquals(box(web.getValue("yours").jsonObject), box(model.yours))
        val webTheirs = web.getValue("theirs").jsonObject
        assertEquals(box(webTheirs), box(model.theirs))
        assertEquals(webTheirs.text("aside"), model.theirs.aside)
        assertEquals(RosterSwitch("You, 1", "${webTheirs.text("team")}, 2"), model.rosters)
        val pin = model.pin as BuilderPinWords.Gains
        assertEquals(web.text("pin"), "${pin.mine} ${pin.rest}")
        assertTrue(model.live)
        assertTrue(model.verbEnabled)
        assertTrue(web["close"] is JsonNull)
    }

    /** Lane 277: where a side would not take it, the pin says why in place of the gains, as the web's pin;
     * an answer for other ticks is drawn but no verb acts on it (builder.ts proposable). */
    @Test
    fun `a refusal takes the pin and a stale answer holds the verbs`() {
        val picks = webPicks()
        val base = TradeFixtures.check()
        words.getValue("checks").jsonArray.map { it.jsonObject }.forEach { edit ->
            val check = edited(base, edit)
            val model = builder(picks, check, picks)
            val refusal = edit.text("refusal")
            if (TradeChecks.fillsBoth(check) && refusal != null) {
                assertEquals(BuilderPinWords.Said(refusal), model.pin, edit.text("name"))
            } else if (!TradeChecks.fillsBoth(check)) {
                assertEquals(BuilderPinWords.Said(edit.text("sentence").orEmpty()), model.pin, edit.text("name"))
                assertFalse(model.live, edit.text("name"))
            }
        }
        val stale = builder(picks.tapped(PickSide.Get, picks.get.first()), base, picks)
        assertFalse(stale.live)
        assertNull(stale.pressed)
    }

    /** No team chosen: the web's line, their box the choice alone, the switch's "Pick a team". */
    @Test
    fun `before a team is chosen the builder says pick a team`() {
        val model = builder(TradePicks(null, emptyList(), emptyList()), null, null)
        assertEquals(Words.Analyzer.noTeam, model.sentence)
        assertEquals(Words.Analyzer.pickTeam, model.teamLabel)
        assertEquals(RosterSwitch("You", Words.Analyzer.pickTeam), model.rosters)
        assertTrue(model.theirs.rows.isEmpty())
        assertTrue(model.theirs.holds.isEmpty())
        assertFalse(model.verbEnabled)
    }
}
