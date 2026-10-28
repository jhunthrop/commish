package app.trycommish.core.trades

import app.trycommish.api.CommishJson
import app.trycommish.api.models.GameStateCell
import app.trycommish.api.models.LeagueHost
import app.trycommish.api.models.TradeCheck
import app.trycommish.core.leaguehome.Fixtures
import app.trycommish.core.start.GameRead
import app.trycommish.core.start.LineRead
import app.trycommish.core.start.StartFixtures
import app.trycommish.core.start.int
import app.trycommish.core.start.rowOf
import app.trycommish.core.start.text
import app.trycommish.design.Words
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.MethodSource

/**
 * The Trades port held to the web's Trades at 390 (shared/fixtures/parity/trades.json, Lane 189's file),
 * as the iOS port is: the decision, the strip, the chips, the finder in both orders with each trade's
 * opened players and its offer (the share text), the bases closed, opened and building at all six fixture
 * clocks; each check the fixtures post as the scoreboard draws it; the line under a pressed verb.
 */
class TradesParityTest {
    private val parity: JsonObject = TradesParity.file

    private fun web(clock: String): JsonObject =
        parity
            .getValue("clocks")
            .jsonObject
            .getValue(clock)
            .jsonObject

    @ParameterizedTest
    @MethodSource("clocks")
    fun `the decision, the strip and the chips are the web's`(clock: String) {
        val web = web(clock)
        val model = TradesParity.model(clock)
        assertEquals(web.text("decision"), model.decision)
        assertEquals(TradesParity.strip(web["strip"]), model.strip?.let(TradesParity::strip))
        val chips = web.getValue("chips").jsonObject
        assertEquals(chips.text("best"), model.best)
        assertEquals(chips.text("every"), model.every)
        assertEquals(web.text("gainBasis"), model.gainBasis)
        assertEquals(web.text("verb"), model.verb)
        assertEquals(web.text("reason"), model.reason)
    }

    @ParameterizedTest
    @MethodSource("clocks")
    fun `every row in every order is the web's`(clock: String) {
        val finder = web(clock).getValue("finder").jsonObject
        for (every in listOf(false, true)) {
            for (sort in TradeSort.entries) {
                val theirs =
                    finder
                        .getValue(if (every) "every" else "best")
                        .jsonObject
                        .getValue(sort.key)
                        .jsonArray
                val ours = TradesParity.model(clock, every, sort).rows
                assertEquals(theirs.map { it.jsonObject.text("key") }, ours.map { it.key }, "$clock $every $sort")
                ours.zip(theirs).forEach { (line, web) -> assertEquals(TradesParity.row(web.jsonObject), TradesParity.row(line), line.key) }
            }
        }
    }

    @ParameterizedTest
    @MethodSource("clocks")
    fun `every offer is the web's share text`(clock: String) {
        val web =
            web(clock)
                .getValue("finder")
                .jsonObject
                .getValue("every")
                .jsonObject
                .getValue("mine")
                .jsonArray
        val offers = TradesParity.model(clock, every = true).rows.map { it.offer }
        assertEquals(web.map { it.jsonObject.text("offer") }, offers)
        assertTrue(offers.isNotEmpty())
    }

    @ParameterizedTest
    @MethodSource("clocks")
    fun `the basis is the web's phone paragraph closed, opened and building`(clock: String) {
        val basis = web(clock).getValue("basis").jsonObject
        val model = TradesParity.model(clock)
        val record = Words.InSeason.orderRecord
        assertEquals(basis.text("closed"), "${model.basis(TradesOpened.None)} $record")
        assertEquals(basis.text("opened"), "${model.basis(TradesOpened.Trade)} $record")
        assertEquals(basis.text("builder"), "${model.basis(TradesOpened.Builder)} $record")
    }

    @ParameterizedTest
    @MethodSource("checkClocks")
    fun `every check is the web's scoreboard`(clock: String) {
        val checks =
            parity
                .getValue("checks")
                .jsonObject
                .getValue(clock)
                .jsonArray
        val strip = requireNotNull(TradesParity.model(clock).strip) { "no strip at $clock" }
        assertEquals(2, checks.size)
        checks.forEachIndexed { index, web ->
            val check = TradeChecks.held(TradeFixtures.check(clock, index + 1), StartFixtures.instant(clock))
            val ours = TradesParity.check(check, TradesParity.me, strip.cards[index].team)
            assertEquals(TradesParity.check(web.jsonObject), ours, "$clock ${index + 1}")
        }
    }

    /** B271: each team the finder lists no trade with keeps its place, said, as the web's ideas row
     * draws it (its places of kind none, in order). */
    @ParameterizedTest
    @MethodSource("clocks")
    fun `every team with no idea is the web's`(clock: String) {
        val places =
            web(clock)
                .getValue("ideas")
                .jsonObject
                .getValue("places")
                .jsonArray
                .map { it.jsonObject }
                .filter { it.text("kind") == "none" }
        val model = TradesParity.model(clock)
        assertEquals(places.map { it.int("rosterId") }, model.noIdeas.map { it.id }, clock)
        assertEquals(places.map { it.text("team") }, model.noIdeas.map { it.team }, clock)
        assertTrue(places.all { it.text("note") == Words.Trades.noIdea })
        assertTrue(model.noIdeas.all { it.note == Words.Trades.noIdea })
    }

    @Test
    fun `the fixture drops every idea with a team`() {
        assertTrue(TradesParity.model(TradeFixtures.WEEK).noIdeas.isNotEmpty())
    }

    @Test
    fun `the line under a pressed verb is the web's`() {
        val copied = parity.getValue("copied").jsonObject
        assertEquals(copied.text("done"), TradesWords.copied(true, "FFPC").words)
        assertEquals(copied.text("failed"), TradesWords.copied(false, "FFPC").words)
    }

    @Test
    fun `the opened rows read each line's game state from its field`() {
        val clock = TradeFixtures.SUNDAY
        val now = StartFixtures.instant(clock)
        val advice = TradeFixtures.trades(clock)
        val row = advice.teams.flatMap { it.trades }.first { TradeFinder.key(8, it) == TradeFixtures.BEST }
        val moved = row.give + row.get + listOfNotNull(row.drop)
        val opened = requireNotNull(TradesParity.model(clock).row(TradeFixtures.BEST)).opened.groups.flatMap { it.rows }
        // Each opened row's state is the port's reading of its line's field.
        moved.forEach { line ->
            val cells = opened.first { it.id == line.player.hostId }
            assertEquals(LineRead.game(line, now).stateName, cells.row.read.stateName, line.player.name)
        }
        // A line in play by its field locks the trade's week change (heldRow), as the parity file's week is null.
        assertTrue(moved.any { LineRead.game(it, now).locked })
        assertEquals(
            null,
            TradesParity
                .model(clock)
                .row(TradeFixtures.BEST)
                ?.opened
                ?.week,
        )
        // The field, not the clock, decides: the same line marked final reads final at Saturday noon.
        val line = moved.first()
        val final = line.copy(gameState = GameStateCell(GameStateCell.State.final, "Final"))
        assertEquals(GameRead.Final, LineRead.game(final, StartFixtures.instant(TradeFixtures.WEEK)))
        // A line with no field is never read as still to come: the trade's week change is held.
        val unread = row.copy(give = row.give.map { it.copy(gameState = null) })
        assertFalse(TradeChecks.countsThisWeek(unread, StartFixtures.instant(TradeFixtures.WEEK)))
    }

    companion object {
        @JvmStatic
        fun clocks(): List<String> = StartFixtures.clocks

        @JvmStatic
        fun checkClocks(): List<String> = listOf(TradeFixtures.WEEK, TradeFixtures.SUNDAY)
    }
}

/** shared/fixtures/parity/trades.json, and the port's same parts in the order the web writes them. */
internal object TradesParity {
    val file: JsonObject = CommishJson.parseToJsonElement(TradeFixtures.parity()).jsonObject
    val me: String = file.text("me").orEmpty()
    val host = LeagueHost.ffpc

    fun model(
        clock: String,
        every: Boolean = false,
        sort: TradeSort = TradeSort.Mine,
    ): TradesModel =
        TradesModel(TradeFixtures.trades(clock), null, null, host, me, every, sort, StartFixtures.instant(clock), Fixtures.zone)

    private fun JsonObject.obj(key: String): JsonObject? = get(key)?.takeUnless { it is JsonNull }?.jsonObject

    fun strip(web: Any?): List<Any?>? {
        val strip = (web as? JsonObject) ?: return null
        val cards =
            strip.getValue("cards").jsonArray.map {
                val card = it.jsonObject
                listOf("key", "mark", "team", "give", "get", "mine", "theirs", "need", "week", "drop", "dropReason").map(card::text)
            }
        return listOf(strip.text("week"), strip.text("title"), strip.text("reason"), cards)
    }

    fun strip(strip: TradesStrip): List<Any?> =
        listOf(
            strip.week,
            strip.title,
            strip.reason,
            strip.cards.map {
                listOf(it.key, it.mark, it.team, it.give, it.get, it.mine, it.theirs, it.need, it.week, it.drop, it.dropReason)
            },
        )

    private fun gain(web: JsonObject?): List<String?> = listOf(web?.text("gain"), web?.text("tone"))

    /** A finder row as the web's JSON writes it. */
    fun row(web: JsonObject): List<Any?> {
        val opened = web.getValue("opened").jsonObject
        val groups =
            opened.getValue("groups").jsonArray.map { group ->
                val g = group.jsonObject
                listOf(g.text("head"), g.getValue("rows").jsonArray.map { openedRow(it.jsonObject) })
            }
        return listOf(
            web.text("key"),
            web.text("team"),
            web.text("give"),
            web.text("get"),
            web.text("with"),
            web.text("need"),
            gain(web.obj("mine")),
            gain(web.obj("theirs")),
            web.text("offer"),
            listOf(opened.text("week"), opened.text("dropReason"), groups),
        )
    }

    /** The same row from the port. */
    fun row(line: TradeLine): List<Any?> =
        listOf(
            line.key,
            line.team,
            line.give,
            line.get,
            line.with,
            line.need,
            listOf(line.mine.words, line.mine.tone.word),
            listOf(line.theirs.words, line.theirs.tone.word),
            line.offer,
            listOf(
                line.opened.week,
                line.opened.dropReason,
                line.opened.groups.map { group -> listOf(group.head, group.rows.map { rowOf(it) + it.season }) },
            ),
        )

    fun openedRow(web: JsonObject): List<Any?> = rowOf(web) + web.text("season")

    private val figureKeys =
        listOf("projBefore", "projAfter", "projChange", "projTone", "seasonBefore", "seasonAfter", "seasonChange", "seasonTone")

    private fun side(web: JsonObject): List<Any?> {
        val figures = web.getValue("figures").jsonObject
        return listOf(web.text("label"), web.text("name"), figureKeys.map(figures::text), web.text("room"))
    }

    private fun side(side: TradeBugSide): List<Any?> {
        val f = side.figures
        val figures =
            listOf(
                f.projBefore,
                f.projAfter,
                f.projChange,
                f.projTone.word,
                f.seasonBefore,
                f.seasonAfter,
                f.seasonChange,
                f.seasonTone.word,
            )
        return listOf(side.label, side.name, figures, side.room)
    }

    /** A check as the web's JSON writes it. */
    fun check(web: JsonObject): List<Any?> =
        listOf(side(web.getValue("yours").jsonObject), side(web.getValue("theirs").jsonObject), web.text("sentence"), web.text("basis"))

    /** A check as the scoreboard and its answer line draw it, held at its clock. */
    fun check(
        check: TradeCheck,
        me: String,
        team: String,
    ): List<Any?> {
        val trade = check.trade
        val room = TradeChecks.room(check)
        val yours = TradeBugSide.of(true, me, check.totals.yours, trade.myGain, trade.myProjChange, room.yours)
        val theirs = TradeBugSide.of(false, team, check.totals.theirs, trade.theirGain, trade.theirProjChange, room.theirs)
        return listOf(side(yours), side(theirs), TradeChecks.words(check), check.basis)
    }
}
