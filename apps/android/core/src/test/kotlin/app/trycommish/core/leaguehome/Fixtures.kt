package app.trycommish.core.leaguehome

import app.trycommish.api.decodeEnvelope
import app.trycommish.api.models.LeagueSync
import app.trycommish.api.models.Scoreboard
import java.io.File
import java.time.Instant
import java.time.ZoneId

/** The shared in-season fixture (shared/fixtures/README.md): the FFPC league and its scoreboard at
 * each fixture clock, read as the API sends them. */
object Fixtures {
    const val LEAGUE_ID = "6f1d1c52-2626-4a26-9a26-000000000026"

    /** The member's zone the web's shots draw in, so the words match the web's at the same clock. */
    val zone: ZoneId = ZoneId.of("America/Chicago")

    /** The fixture clocks, by the README's names. */
    val week: Instant = Instant.parse("2026-10-17T17:00:00Z")
    val sunday: Instant = Instant.parse("2026-10-18T18:56:00Z")
    val tuesday: Instant = Instant.parse("2026-10-20T17:00:00Z")

    private val inseason = File(System.getProperty("fixtures"), "inseason")

    fun syncBody(): String = File(inseason, "leagues-attached-$LEAGUE_ID.json").readText()

    /** The scoreboard's answer at a clock, its file named by the instant with dashes for colons. */
    fun scoreboardBody(clock: Instant): String {
        val name = clock.toString().replace(":", "-")
        return File(inseason, "scoreboard-$LEAGUE_ID-$name.json").readText()
    }

    fun sync(): LeagueSync = decodeEnvelope(syncBody())

    fun scoreboard(clock: Instant): Scoreboard = decodeEnvelope(scoreboardBody(clock))
}
