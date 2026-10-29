package app.trycommish.core.trades

import app.trycommish.api.CommishJson
import app.trycommish.api.models.LeagueHost
import app.trycommish.api.models.TradeCheck
import app.trycommish.core.leaguehome.Fixtures
import app.trycommish.core.start.StartFixtures
import app.trycommish.core.start.int
import app.trycommish.core.start.text
import app.trycommish.design.Words
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.MethodSource

/**
 * The Trades port held to the web's builder-first Trades at 390 (shared/fixtures/parity/trades.json, Lanes
 * 260, 268, 277), as the iOS port is: the ideas row (each idea's mark, team, gains and deal, each team with
 * none and its note, in the row's order), the verb, the platform's note and the builder's basis at all six
 * fixture clocks; each check the fixtures post as the verdict draws it; the line under a pressed verb.
 */
class TradesParityTest {
    private val parity: JsonObject = TradesParity.file

    private fun web(clock: String): JsonObject =
        parity
            .getValue("clocks")
            .jsonObject
            .getValue(clock)
            .jsonObject

    private fun places(clock: String): List<JsonObject> =
        web(clock)
            .getValue("ideas")
            .jsonObject
            .getValue("places")
            .jsonArray
            .map { it.jsonObject }

    @ParameterizedTest
    @MethodSource("clocks")
    fun `the ideas row is the web's`(clock: String) {
        val model = TradesParity.model(clock)
        val places = places(clock)
        assertEquals(web(clock).getValue("ideas").jsonObject.text("head"), model.ideas.head)
        assertEquals(places.map(TradesParity::place), model.ideas.places.map(TradesParity::place), clock)
        // Best first, the screen opening on its team with nothing ticked.
        assertEquals(Words.Strip.best, places.first().text("mark"))
        assertEquals(TradePicks(places.first().int("rosterId"), emptyList(), emptyList()), model.opening)
    }

    @ParameterizedTest
    @MethodSource("clocks")
    fun `the best three show, then the rest behind N more`(clock: String) {
        val ideas = TradesParity.model(clock).ideas
        val places = places(clock)
        assertEquals(places.take(TradeIdeas.SHOWN).map { it.text("key") }, ideas.visible(all = false).map { it.key })
        assertEquals("${places.size - TradeIdeas.SHOWN} more", ideas.more(all = false))
        assertEquals(places.size, ideas.visible(all = true).size)
        assertNull(ideas.more(all = true))
    }

    @ParameterizedTest
    @MethodSource("clocks")
    fun `the verb and the basis are the web's`(clock: String) {
        val web = web(clock)
        val model = TradesParity.model(clock)
        assertEquals(web.text("verb"), model.verb)
        assertEquals(web.text("reason"), model.reason)
        assertEquals(web.getValue("basis").jsonObject.text("builder"), "${model.basis} ${Words.InSeason.orderRecord}")
    }

    @ParameterizedTest
    @MethodSource("checkClocks")
    fun `every check is the web's verdict`(clock: String) {
        val checks =
            parity
                .getValue("checks")
                .jsonObject
                .getValue(clock)
                .jsonArray
        val teams = TradeFinder.worthProposing(TradeFixtures.trades(clock).teams).map { it.team.name }
        assertEquals(2, checks.size)
        checks.forEachIndexed { index, web ->
            val check = TradeChecks.held(TradeFixtures.check(clock, index + 1), StartFixtures.instant(clock))
            val ours = TradesParity.check(check, TradesParity.me, teams[index])
            assertEquals(TradesParity.check(web.jsonObject), ours, "$clock ${index + 1}")
        }
    }

    @Test
    fun `the fixture drops every idea with a team`() {
        assertTrue(
            TradesParity
                .model(TradeFixtures.WEEK)
                .ideas.places
                .any { it is IdeaPlace.None },
        )
    }

    @Test
    fun `the line under a pressed verb is the web's`() {
        val copied = parity.getValue("copied").jsonObject
        assertEquals(copied.text("done"), TradesWords.copied(true, "FFPC").words)
        assertEquals(copied.text("failed"), TradesWords.copied(false, "FFPC").words)
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

    fun model(clock: String): TradesModel = TradesModel(TradeFixtures.trades(clock), host, StartFixtures.instant(clock), Fixtures.zone)

    private val placeKeys = listOf("kind", "key", "rosterId", "team", "mark", "gains", "deal", "note")

    /** An ideas row's place as the web's JSON writes it. */
    fun place(web: JsonObject): List<String?> = placeKeys.map(web::text)

    /** The same place from the port. */
    fun place(place: IdeaPlace): List<String?> =
        when (place) {
            is IdeaPlace.Idea -> {
                val p = place.preset
                listOf("idea", p.key, p.rosterId.toString(), p.team, p.mark, p.gains, p.deal, null)
            }
            is IdeaPlace.None -> {
                val line = place.line
                listOf("none", place.key, line.id.toString(), line.team, null, null, null, line.note)
            }
        }

    private val figureKeys =
        listOf("projBefore", "projAfter", "projChange", "projTone", "seasonBefore", "seasonAfter", "seasonChange", "seasonTone")

    private fun side(web: JsonObject): List<Any?> {
        val figures = web.getValue("figures").jsonObject
        val rest = web.getValue("rest").jsonObject
        return listOf(
            web.text("label"),
            web.text("name"),
            figureKeys.map(figures::text),
            web.text("room"),
            listOf(rest.text("text"), rest.text("tone"), rest.text("refuses")),
        )
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
        return listOf(side.label, side.name, figures, side.room, rest(side.rest))
    }

    /** A rest-of-season cell as the web's JSON writes it. */
    fun rest(rest: TradeRest): List<String> = listOf(rest.text, rest.tone.word, rest.refuses.toString())

    /** A check as the web's JSON writes it. */
    fun check(web: JsonObject): List<Any?> =
        listOf(side(web.getValue("yours").jsonObject), side(web.getValue("theirs").jsonObject), web.text("sentence"), web.text("basis"))

    /** A check as the verdict and its answer line draw it, held at its clock. */
    fun check(
        check: TradeCheck,
        me: String,
        team: String,
    ): List<Any?> {
        val bug = TradeBuilder.bug(check, me, team)
        return listOf(side(bug.yours), side(bug.theirs), TradeChecks.words(check), check.basis)
    }
}
