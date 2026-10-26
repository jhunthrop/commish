package app.trycommish.core.rankings

import app.trycommish.api.CommishJson
import app.trycommish.api.decodeEnvelope
import app.trycommish.core.leaguehome.Fixtures
import app.trycommish.core.start.text
import kotlinx.serialization.json.jsonObject
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.File
import java.time.Instant

/**
 * The pill slot's candidates bound every pill the order prints (Lane 215 review H1): over every order read
 * the fixture holds, at both clocks, each pill is a candidate's position with a rank of no more digits than
 * the candidates hold (its digits no wider together than the widest digit that many times), or a candidate
 * outright. A three-digit rank is reached, so the bound is exercised.
 */
class RankingsPillsTest {
    private val parity = CommishJson.parseToJsonElement(RankingsFixtures.parity("rankings")).jsonObject

    private fun pills(): List<String> =
        parity.getValue("orders").jsonObject.values.flatMap { case ->
            val web = case.jsonObject
            val clock = Instant.parse(web.text("clock"))
            val chip = web.text("chip")?.let { api -> RankingsChip.entries.first { it.api == api } }
            val body = File(System.getProperty("fixtures"), "inseason/${web.text("file")}").readText()
            rankingsModel(decodeEnvelope(body), chip, "", true, Fixtures.zone, clock).rows.mapNotNull { it.player.pill }
        }

    @Test
    fun `every pill the order prints is bounded by a candidate`() {
        val pills = pills()
        val ranked = Regex("^(\\S+) (\\d+)$")
        assertTrue(
            pills.any {
                ranked
                    .find(it)
                    ?.groupValues
                    ?.get(2)
                    ?.length == RankingsPills.MOST_DIGITS
            },
            "a three-digit rank is reached",
        )
        val unbounded =
            pills.filterNot { pill ->
                val match = ranked.find(pill)
                if (match == null) {
                    pill in RankingsPills.widestCandidates || pill in RankingsPills.positions
                } else {
                    match.groupValues[1] in RankingsPills.positions && match.groupValues[2].length <= RankingsPills.MOST_DIGITS
                }
            }
        assertEquals(emptyList<String>(), unbounded)
    }
}
