package app.trycommish.core.waivers

import app.trycommish.core.start.text
import app.trycommish.design.Words
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.double
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.MethodSource
import kotlin.math.abs

/**
 * shared/fixtures/parity/waivers.json's `nav` on each screen, as the web's Waivers navigates by its
 * position cards (position-nav.ts, Lane 305), as the iOS port is held: the card it opens on, whether the
 * toggle is drawn, and for each figure the toggle reads the row of cards, the lead and the member's players
 * at every card and the list's sort; then the page's rows at each card until the position's own read lands.
 */
class WaiverNavParityTest {
    private val parity = WaiverParityTest()

    private fun nav(name: String): JsonObject = parity.web(name).getValue("nav").jsonObject

    private fun JsonObject.flag(key: String): Boolean = getValue(key).jsonPrimitive.boolean

    private fun JsonObject.mode(key: String): JsonObject? = get(key)?.takeUnless { it is JsonNull }?.jsonObject

    private fun keys(element: JsonElement): List<String> = element.jsonArray.map { it.jsonPrimitive.content }

    /** A card as the web's JSON writes it, the meter's share apart (held to a tolerance). */
    private fun webCard(card: JsonObject): List<Any?> =
        listOf(
            card.text("key"),
            card.text("word"),
            card.text("place"),
            card.text("figure"),
            card.text("foot"),
            card.text("tag"),
            card.flag("need"),
            card.flag("pickup"),
            card.text("waits"),
            card.mode("meter")?.flag("under"),
        )

    private fun portCard(card: NavCard): List<Any?> =
        listOf(card.key, card.word, card.place, card.figure, card.foot, card.tag, card.need, card.pickup, card.waits, card.meter?.under)

    private fun assertMode(
        name: String,
        model: WaiverModel,
        mode: PanelMode,
        web: JsonObject,
    ) {
        assertEquals(web.text("explain"), mode.explain)
        val sort = WaiverNav.sort(mode)
        val webSort = web.getValue("sort").jsonObject
        assertEquals(webSort.text("key") to webSort.flag("down"), sort.key.key to sort.down)
        val cards = model.nav(mode)
        val webCards = web.getValue("cards").jsonArray.map { it.jsonObject }
        assertEquals(webCards.map { webCard(it) }, cards.map { portCard(it) }, "$name $mode")
        webCards.zip(cards).forEach { (w, p) ->
            val share =
                w
                    .mode("meter")
                    ?.getValue("share")
                    ?.jsonPrimitive
                    ?.double ?: -1.0
            assertTrue(abs(share - (p.meter?.share ?: -1.0)) < 1e-9, "$name $mode ${p.key}")
        }
        val leads = web.getValue("leads").jsonObject
        val yours = web.getValue("yours").jsonObject
        cards.forEach { card ->
            val lead = leads.getValue(card.key).jsonObject
            assertEquals(lead.text("head") to lead.text("words"), model.lead(card.key, mode).let { it.head to it.words }, card.key)
            val webYours =
                yours.getValue(card.key).jsonArray.map { it.jsonObject }.map {
                    listOf(it.text("key"), it.text("name"), it.text("rest")?.toDouble(), it.text("role"), it.flag("starts"))
                }
            val portYours = model.yours(card.key, mode).map { listOf(it.key, it.cells.row.name, it.rest, it.role, it.starts) }
            assertEquals(webYours, portYours, "$name $mode ${card.key}")
        }
    }

    @ParameterizedTest
    @MethodSource("app.trycommish.core.waivers.WaiverParityTest#screens")
    fun `the cards are the web's`(name: String) {
        val web = nav(name)
        val model = parity.model(name)
        assertEquals(web.text("opening"), model.opening)
        assertEquals(web.flag("hasWeek"), model.navHasWeek)
        assertMode(name, model, PanelMode.Season, web.getValue("season").jsonObject)
        val week = web.mode("week")
        assertEquals(week != null, web.flag("hasWeek"))
        week?.let { assertMode(name, model, PanelMode.Week, it) }
        web.getValue("atPosition").jsonObject.forEach { (key, value) ->
            val here = WaiverNav.atPosition(model.advice, key)
            val rows = value.jsonObject
            assertEquals(keys(rows.getValue("rows")), here.rows.map { WaiverRows.key(it) }, key)
            assertEquals(keys(rows.getValue("stash")), here.stash.orEmpty().map { WaiverRows.key(it) }, key)
        }
    }

    /** The fixture holds each state the cards draw, so the test above holds each. */
    @Test
    fun `every state is in the fixture`() {
        val navs = WaiverParityTest.screens().map { nav(it) }
        val season = navs.map { it.getValue("season").jsonObject }
        val cards = season.flatMap { m -> m.getValue("cards").jsonArray.map { it.jsonObject } }
        assertTrue(navs.any { it.text("opening") == "TE" } && navs.any { it.text("opening") == WaiverNav.ALL })
        assertTrue(cards.any { it.flag("need") })
        assertTrue(cards.any { it.text("key") == "DEF" && it.text("tag") == Words.WaiverNav.weekTag })
        assertTrue(cards.any { it.text("waits") == Words.WaiverNav.waits && it.text("place") == null })
        assertTrue(navs.any { it.flag("hasWeek") } && navs.any { !it.flag("hasWeek") })
        assertTrue(
            season.any {
                it
                    .getValue("leads")
                    .jsonObject["DEF"]
                    ?.jsonObject
                    ?.text("words") == WaiverNav.swapped("D/ST")
            },
        )
        assertTrue(
            season.any {
                it
                    .getValue("leads")
                    .jsonObject["TE"]
                    ?.jsonObject
                    ?.text("words") == Words.WaiverPanel.needSays
            },
        )
        assertTrue(
            season.any {
                (
                    it
                        .getValue("yours")
                        .jsonObject["QB"]
                        ?.jsonArray
                        ?.size ?: 0
                ) > 1
            },
        )
        assertTrue(
            season.any { m ->
                val all = m.getValue("cards").jsonArray.map { it.jsonObject }
                all.size > 1 && all.all { it.mode("meter") == null }
            },
        )
        // No card, on either toggle, prints a bare "--" in any field.
        val every =
            navs.flatMap { listOfNotNull(it.mode("season"), it.mode("week")) }.flatMap { m ->
                m.getValue("cards").jsonArray.map { it.jsonObject }
            }
        assertTrue(every.all { card -> listOf("place", "figure", "foot", "tag", "waits").none { card.text(it) == Words.Box.none } })
    }

    /** The words the port builds are the web's (position-nav.ts NAV's functions). */
    @Test
    fun `the built words are the web's`() {
        assertEquals("Your TE", WaiverNav.yours("TE"))
        assertEquals("Free at TE", WaiverNav.freeAt("TE"))
        assertEquals("K has no rest-of-season order, so its card ranks this week's Proj.", WaiverNav.swapped("K"))
        assertEquals("Showing the first read's players at TE.", WaiverNav.firstRead("TE"))
    }
}
