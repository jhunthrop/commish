package app.trycommish.core.start

import app.trycommish.api.CommishRequestJson
import app.trycommish.api.decodeEnvelope
import app.trycommish.api.models.LeagueHost
import app.trycommish.api.models.LineupAdvice
import app.trycommish.api.models.LineupMoves
import app.trycommish.core.leaguehome.Fixtures
import java.io.File
import java.time.Instant

/** The shared fixture league's lineup (GET /leagues/attached/{id}/lineup) at its six clocks, as the API
 * sends it, and as a platform that takes lineups from here (ESPN) sends the same answer. */
object StartFixtures {
    /** The six clocks the lineup answers are kept at, by their file names. */
    val clocks =
        listOf(
            "2026-10-16T02-00-00Z",
            "2026-10-17T17-00-00Z",
            "2026-10-18T18-56-00Z",
            "2026-10-19T16-00-00Z",
            "2026-10-20T00-40-00Z",
            "2026-10-20T17-00-00Z",
        )

    /** Saturday noon, before any Sunday kickoff: swaps offered. */
    const val WEEK = "2026-10-17T17-00-00Z"

    /** Sunday 18:56Z, the noon games in play (plan Review Focus 1). */
    const val SUNDAY = "2026-10-18T18-56-00Z"

    /** Monday night, every starter kicked off: held. */
    const val HELD = "2026-10-20T00-40-00Z"

    val ffpc = LeagueHost.ffpc
    val espn = LeagueHost.espn

    private val inseason = File(System.getProperty("fixtures"), "inseason")

    /** A file clock as its instant: `2026-10-18T18-56-00Z` is 18:56 UTC that day. */
    fun instant(clock: String): Instant = Instant.parse(clock.replace(Regex("T(\\d\\d)-(\\d\\d)-(\\d\\d)Z"), "T$1:$2:$3Z"))

    fun lineupBody(clock: String): String = File(inseason, "lineup-${Fixtures.LEAGUE_ID}-$clock.json").readText()

    fun lineup(clock: String): LineupAdvice = decodeEnvelope(lineupBody(clock))

    /** The moves a platform that takes the lineup from here answers with. */
    val writesOpen = LineupMoves(takesWrites = true, writesOn = true, reason = null, lineup = LineupMoves.Lineup.available, note = null)

    /** The fixture's lineup as ESPN, which takes the lineup from here, sends it. */
    fun writes(clock: String): LineupAdvice = lineup(clock).copy(moves = writesOpen)

    /** [writes] as a body the API sends: the envelope around it. */
    fun writesBody(clock: String): String =
        lineupBody(
            clock,
        ).replace(
            Regex("\"moves\":\\s*\\{[^}]*\\}"),
            "\"moves\": {\"takes_writes\": true, \"writes_on\": true, \"reason\": null, \"lineup\": \"available\", \"note\": null}",
        )

    /** The parity file the web's readers wrote (shared/scripts/lineup-parity.ts). */
    fun parity(): String = File(System.getProperty("fixtures"), "parity/lineup.json").readText()
}

/** An answer as the API sends it: the envelope around the data, every null written. */
fun envelopeOf(advice: LineupAdvice): String =
    """{"ok":true,"data":${CommishRequestJson.encodeToString(LineupAdvice.serializer(), advice)},"error":null}"""
