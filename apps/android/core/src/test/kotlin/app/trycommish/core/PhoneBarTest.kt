package app.trycommish.core

import app.trycommish.api.CommishJson
import app.trycommish.api.models.BoardFormat
import app.trycommish.api.models.LeagueHost
import app.trycommish.api.models.LeaguePhase
import app.trycommish.api.models.SiteSeason
import app.trycommish.core.shell.FollowedLeague
import app.trycommish.design.Rail
import app.trycommish.design.RailItem
import kotlinx.serialization.Serializable
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import java.io.File

/** The bottom bar is the web's phone five for the league's phase (rail-order.ts railFor) and, with no
 * league, for the site's season (railShown over railPhase(null, season)), generated into
 * Rail.generated.kt and held here to shared/fixtures/parity/phone-rail.json, what the web draws at
 * 390 px. */
class PhoneBarTest {
    @Serializable
    private data class Item(
        val key: String,
        val label: String,
    )

    @Serializable
    private data class PhoneRail(
        val phases: Map<String, List<Item>>,
        val withoutLeague: List<Item>,
        val withoutLeagueBySeason: Map<String, List<Item>>,
        val account: Item,
    )

    private val web: PhoneRail =
        CommishJson.decodeFromString(File(System.getProperty("fixtures"), "parity/phone-rail.json").readText())

    private fun items(bar: List<RailItem>) = bar.map { Item(it.key, it.label) }

    private fun league(
        phase: LeaguePhase,
        waiversOpen: Boolean,
    ) = FollowedLeague("id", "L", LeagueHost.sleeper, null, BoardFormat.ppr, phase, null, waiversOpen)

    @Test
    fun `every phase's bar is the web's`() {
        LeaguePhase.entries.filter { it != LeaguePhase.unknown_default_open_api }.forEach { phase ->
            val key = if (phase == LeaguePhase.playoffs) "playoffs" else phase.value
            assertEquals(web.phases.getValue(key), items(phoneBar(league(phase, phase != LeaguePhase.playoffs), null)), key)
        }
        assertEquals(web.phases.getValue("playoffs_waivers"), items(phoneBar(league(LeaguePhase.playoffs, true), null)))
    }

    @Test
    fun `with no league the bar is the web's for the site's season`() {
        SiteSeason.Phase.entries.filter { it != SiteSeason.Phase.unknown_default_open_api }.forEach { season ->
            assertEquals(web.withoutLeagueBySeason.getValue(season.value), items(phoneBar(null, season)), season.value)
        }
        assertEquals(web.withoutLeague, items(Rail.withoutLeague))
    }

    @Test
    fun `no season read, or a phase this build does not know, reads as in season with no league`() {
        val inSeason = web.withoutLeagueBySeason.getValue("in_season")
        assertEquals(inSeason, items(phoneBar(null, null)))
        assertEquals(inSeason, items(phoneBar(league(LeaguePhase.unknown_default_open_api, true), null)))
    }

    @Test
    fun `the account's way in is the web's rail foot`() {
        assertEquals(web.account.label, app.trycommish.design.Words.Shell.account)
    }
}
