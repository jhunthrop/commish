package app.trycommish.core.leaguehome

import app.trycommish.api.models.LeagueHost
import app.trycommish.core.waivers.WaiverWords
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

/** A platform's words (Lane 310): every real platform says what the screens said before the words were
 * split, and the store graphics' neutral platform places a move in your league. */
class HostWordsTest {
    private val real = listOf(LeagueHost.sleeper, LeagueHost.mfl, LeagueHost.ffpc, LeagueHost.yahoo, LeagueHost.espn)

    /** shared/store/store-host.json, the store graphics' neutral platform. */
    private val neutral = HostWords("your league", "in your league", "Read", "{noun} in your league")

    @Test
    fun `a real platform says what the screens always said`() {
        for (host in real) {
            val name = ValueWords.platform(host)
            val words = HostWords.of(host)
            assertEquals(name, words.name)
            assertEquals("Add on $name", WaiverWords.addOn(words))
            assertEquals("Open $name waivers", WaiverWords.openWaivers(words))
            assertEquals("Open $name trades", "Open ${words.own("trades")}")
            assertEquals("$name 4 min ago", readCell(words.stamp, java.time.Instant.EPOCH, java.time.Instant.ofEpochSecond(240)))
        }
    }

    @Test
    fun `the neutral platform places a move in your league and names no platform`() {
        assertEquals("Add in your league", WaiverWords.addOn(neutral))
        assertEquals("Open waivers in your league", WaiverWords.openWaivers(neutral))
        assertEquals("Open trades in your league", "Open ${neutral.own("trades")}")
        assertEquals("Read 4 min ago", readCell(neutral.stamp, java.time.Instant.EPOCH, java.time.Instant.ofEpochSecond(240)))
    }
}
