package app.trycommish.core.trades

import app.trycommish.api.models.TradeRow
import app.trycommish.api.models.TradeTeam
import app.trycommish.core.leaguehome.Fixtures
import app.trycommish.core.start.StartFixtures
import app.trycommish.core.start.int
import app.trycommish.core.start.text
import app.trycommish.design.Words
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.MethodSource
import java.time.Instant

/**
 * The Trades with the finder's newer fields held to the web (shared/fixtures/parity/trades.json's `needs`,
 * Lane 290), as the iOS port is: the host's offers at the head of the ideas row (each card's label, team,
 * deal, expiry, the ticks it loads or where to answer it), the row's places in the web's order with each
 * idea's fills line, each empty team's line by its reason, the line for every reason and an absent one, the
 * fills words for every slot; an offer lapsing on the injected clock leaves the row.
 */
class TradesNeedsParityTest {
    private val needs: JsonObject = TradesParity.file.getValue("needs").jsonObject
    private val now = StartFixtures.instant(TradeFixtures.WEEK)

    private fun model(at: Instant = now) = TradesModel(TradeFixtures.trades(TradeFixtures.NEEDS), TradesParity.host, at, Fixtures.zone)

    private fun list(key: String): List<JsonObject> = needs.getValue(key).jsonArray.map { it.jsonObject }

    private fun offers(ideas: TradeIdeas): List<OfferPreset> = ideas.places.filterIsInstance<IdeaPlace.Offer>().map { it.offer }

    private fun picks(web: JsonObject): TradePicks? =
        (web["picks"] as? JsonObject)?.let { p ->
            TradePicks(
                p.int("team"),
                p.getValue("give").jsonArray.map {
                    it.jsonPrimitive.content
                },
                p.getValue("get").jsonArray.map { it.jsonPrimitive.content },
            )
        }

    private fun offer(web: JsonObject): List<Any?> =
        listOf(
            web.text("key"),
            web.text("label"),
            web.int("rosterId"),
            web.text("team"),
            web.text("deal"),
            web.text("expires"),
            picks(web),
            web.text("note"),
        )

    private fun offer(o: OfferPreset): List<Any?> = listOf(o.key, o.label, o.rosterId, o.team, o.deal, o.expires, o.picks, o.note)

    @Test
    fun `the offers are the web's`() {
        val web = list("offers")
        assertEquals(web.map(::offer), offers(model().ideas).map(::offer))
        assertEquals(3, web.size)
        assertEquals(2, web.count { picks(it) == null })
    }

    @Test
    fun `the row is the web's with its fills lines`() {
        val places = model().ideas.places
        val web =
            needs
                .getValue("ideas")
                .jsonObject
                .getValue("places")
                .jsonArray
                .map { it.jsonObject }
        assertEquals(web.map(TradesParity::place), places.filter { it !is IdeaPlace.Offer }.map(TradesParity::place))
        assertTrue(web.any { it.text("fills") != null })
        val offers = list("offers").map { it.text("key") }
        val keys = web.map { it.text("key") }
        assertEquals(listOf(offers[0], keys[0]) + offers.drop(1) + keys.drop(1), places.map { it.key })
        assertEquals(Words.Strip.best, web.first().text("mark"))
    }

    @Test
    fun `each empty team says why`() {
        val teams = TradeFixtures.trades(TradeFixtures.NEEDS).teams
        val empty = list("empty")
        empty.forEach { web ->
            val team = teams.first { it.rosterId == web.int("rosterId") }
            assertEquals(web.text("reason"), team.emptyReason?.value)
            assertEquals(web.text("note"), NoIdeaLine.note(team.emptyReason))
        }
        assertEquals(4, empty.map { it.text("note") }.toSet().size)
        val reasons = needs.getValue("reasons").jsonObject
        TradeTeam.EmptyReason.entries.filter { it != TradeTeam.EmptyReason.unknown_default_open_api }.forEach {
            assertEquals(reasons.text(it.value), NoIdeaLine.note(it), it.value)
        }
        assertEquals(reasons.text("absent"), NoIdeaLine.note(null))
    }

    @Test
    fun `the fills words are the web's`() {
        val fills = needs.getValue("fills").jsonObject
        TradeRow.Fills.entries.filter { it != TradeRow.Fills.unknown_default_open_api }.forEach {
            assertEquals(fills.text(it.value), TradesWords.fills(it), it.value)
        }
        assertNull(TradesWords.fills(null))
    }

    @ParameterizedTest
    @MethodSource("clocks")
    fun `an older answer draws no fills line`(clock: String) {
        assertTrue(
            TradesParity
                .model(clock)
                .ideas.places
                .filterIsInstance<IdeaPlace.Idea>()
                .all { it.preset.fills == null },
        )
    }

    @Test
    fun `a lapsed offer leaves the row`() {
        val first = list("offers").first().text("key")
        val ends = requireNotNull(offers(model().ideas).first().endsAt)
        assertFalse(offers(model(ends).ideas).any { it.key == first })
        val drawn = model().ideas.at(ends)
        assertFalse(offers(drawn).any { it.key == first })
        assertEquals(list("offers").size - 1, offers(drawn).size)
    }

    @Test
    fun `an offer loads its ticks and is pressed`() {
        val model = model()
        val web = list("offers").first { picks(it) != null }
        val ticks = requireNotNull(picks(web))
        val builder =
            TradeBuilder.model(
                TradeBuilder.Inputs(
                    advice = TradeFinder.held(TradeFixtures.trades(TradeFixtures.NEEDS), now),
                    ideas = model.ideas,
                    allIdeas = false,
                    picks = ticks,
                    answer = null,
                    answered = null,
                    problem = null,
                    me = TradeMe("", ""),
                    pageKnown = true,
                    zone = Fixtures.zone,
                    now = now,
                ),
            )
        assertEquals(web.text("key"), builder.pressed)
        assertEquals(ticks.get.size, builder.theirs.rows.count { it.tick == PickTick.Picked })
        val unheld = list("offers").first { picks(it) == null }.text("key").orEmpty()
        assertNull(model.picks(unheld, now))
    }

    companion object {
        @JvmStatic
        fun clocks(): List<String> = StartFixtures.clocks
    }
}
