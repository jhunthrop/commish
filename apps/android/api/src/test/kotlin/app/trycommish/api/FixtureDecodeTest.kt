package app.trycommish.api

import app.trycommish.api.models.LeagueHost
import app.trycommish.api.models.LeagueSync
import app.trycommish.api.models.Scoreboard
import app.trycommish.api.models.ScoreboardGame
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.File

/** The generated types read the shared fixtures (shared/fixtures/inseason) exactly as the API sends
 * them, and an answer carrying a field this build does not know still reads (additive fields). */
class FixtureDecodeTest {
    private val inseason = File(System.getProperty("fixtures"), "inseason")
    private val leagueId = "6f1d1c52-2626-4a26-9a26-000000000026"

    private fun fixture(name: String): String = File(inseason, name).readText()

    @Test
    fun `the league's sync answer reads into the generated LeagueSync`() {
        val sync = decodeEnvelope<LeagueSync>(fixture("leagues-attached-$leagueId.json"))
        assertEquals(leagueId, sync.id.toString())
        assertEquals(LeagueHost.ffpc, sync.host)
        assertEquals(12, sync.teams.size)
        assertEquals(1, sync.me)
    }

    @Test
    fun `the scoreboard answer reads into the generated Scoreboard`() {
        val board = decodeEnvelope<Scoreboard>(fixture("scoreboard-$leagueId-2026-10-18T18-56-00Z.json"))
        assertEquals(6, board.week)
        assertEquals(ScoreboardGame.State.playing, board.games.first().state)
    }

    @Test
    fun `an answer with a field this build does not know still reads`() {
        val body = fixture("leagues-attached-$leagueId.json")
        val root = CommishJson.parseToJsonElement(body).jsonObject
        val data = root.getValue("data").jsonObject
        val grown = JsonObject(root + ("data" to JsonObject(data + ("a_field_from_next_week" to JsonPrimitive(7)))))
        val sync = decodeEnvelope<LeagueSync>(grown.toString())
        assertEquals(12, sync.teams.size)
    }

    @Test
    fun `the JSON configuration ignores unknown keys`() {
        assertTrue(CommishJson.configuration.ignoreUnknownKeys)
    }
}
