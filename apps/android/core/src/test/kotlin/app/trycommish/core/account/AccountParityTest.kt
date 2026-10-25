package app.trycommish.core.account

import app.trycommish.api.CommishJson
import app.trycommish.core.instantOrNull
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import java.io.File
import java.time.Instant
import java.time.ZoneId

/** Every Account word against shared/fixtures/parity/account.json, which the web's own functions wrote
 * (account/words.ts, league/attached-rows.ts, hosts/device-words.ts, pass/free-season.ts): who, the
 * plan, the free-season rule at both clocks with the flag absent, true and false, all twelve leagues'
 * rows, the counts, the read ages and the device lines. */
class AccountParityTest {
    private val parity: JsonObject =
        CommishJson
            .parseToJsonElement(File(System.getProperty("fixtures"), "parity/account.json").readText())
            .jsonObject
    private val now = Instant.parse(parity.text("now"))
    private val zone = ZoneId.of(parity.text("zone"))

    @Test
    fun `who and the plan read as the web prints them`() {
        val me = AccountFixtures.me()
        val who = parity.getValue("who").jsonObject
        assertEquals(who.text("name"), AccountWords.displayName(me))
        assertEquals(who.text("line"), AccountWords.whoLine(me))
        val plan = parity.getValue("plan").jsonObject
        assertEquals(PlanCard(plan.text("title"), plan.text("line"), PlanCard.free.see), PlanCard.of(me, now, flag = null))
    }

    @Test
    fun `the free season follows the flag first and the clock without it`() {
        val cases = parity.getValue("freeSeason").jsonArray.map { it.jsonObject }
        assertEquals(6, cases.size)
        cases.forEach { case ->
            val flag =
                case
                    .getValue("flag")
                    .takeUnless { it is JsonNull }
                    ?.jsonPrimitive
                    ?.booleanOrNull
            val at = Instant.parse(case.text("now"))
            assertEquals(case.getValue("free").jsonPrimitive.booleanOrNull, PlanCard.freeSeason(at, flag), "$case")
        }
    }

    @Test
    fun `every league's row reads as the web's table`() {
        val leagues = AccountFixtures.leagues().associateBy { it.id }
        val rows = parity.getValue("leagues").jsonArray.map { it.jsonObject }
        assertEquals(12, rows.size)
        rows.forEach { web ->
            val row = AccountWords.leagueRow(leagues.getValue(web.text("id")), now, zone, detached = false)
            assertEquals(
                listOf("name", "team", "record", "place", "season", "read").map { web.text(it) },
                listOf(row.name, row.team, row.record, row.place, row.season, row.read),
                web.text("id"),
            )
        }
    }

    @Test
    fun `the counts, the read ages and the device lines read as the web's`() {
        parity.getValue("counts").jsonArray.map { it.jsonObject }.forEach { case ->
            val count = case.getValue("count").jsonPrimitive.int
            assertEquals(case.text("words"), AccountWords.attachedCount(count))
            assertEquals(case.text("devices"), AccountWords.deviceCount(count))
        }
        parity.getValue("reads").jsonArray.map { it.jsonObject }.forEach { case ->
            val readAt =
                case
                    .getValue("readAt")
                    .takeUnless { it is JsonNull }
                    ?.jsonPrimitive
                    ?.content
            assertEquals(case.text("words"), AccountWords.readWords(instantOrNull(readAt), now))
        }
        val devices = AccountFixtures.devices().associateBy { it.id }
        val lines = parity.getValue("devices").jsonArray.map { it.jsonObject }
        assertEquals(2, lines.size)
        lines.forEach { assertEquals(it.text("line"), AccountWords.deviceLine(devices.getValue(it.text("id")))) }
    }

    private fun JsonObject.text(key: String): String = getValue(key).jsonPrimitive.content
}
