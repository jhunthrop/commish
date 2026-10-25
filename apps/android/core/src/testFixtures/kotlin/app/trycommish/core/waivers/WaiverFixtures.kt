package app.trycommish.core.waivers

import app.trycommish.api.CommishRequestJson
import app.trycommish.api.decodeEnvelope
import app.trycommish.api.models.HostMovePlan
import app.trycommish.api.models.HostMoveResult
import app.trycommish.api.models.WaiverAdvice
import app.trycommish.core.leaguehome.Fixtures
import java.io.File

/** The shared fixture leagues' waivers (GET /leagues/attached/{id}/waivers) as the API sends them: the
 * FFPC stand-in at its six clocks and its D/ST read at the week's, and the three ESPN stand-ins at the
 * week's clock with the claim's plan and its made answer (done, refused, pending), as Lane 186 exported
 * them (shared/fixtures/README.md). */
object WaiverFixtures {
    /** The FFPC stand-in: claims open the platform's page. */
    const val FFPC = Fixtures.LEAGUE_ID

    /** The ESPN stand-ins, each answering the claim with one outcome. */
    const val DONE = "6f1d1c52-2626-4a26-9a26-000000000035"
    const val REFUSED = "6f1d1c52-2626-4a26-9a26-000000000036"
    const val PENDING = "6f1d1c52-2626-4a26-9a26-000000000037"

    /** Saturday noon, the week's clock the ESPN stand-ins are kept at. */
    const val WEEK = "2026-10-17T17-00-00Z"

    private val inseason = File(System.getProperty("fixtures"), "inseason")

    fun body(
        league: String,
        clock: String = WEEK,
    ): String = File(inseason, "waivers-$league-$clock.json").readText()

    fun waivers(
        league: String,
        clock: String = WEEK,
    ): WaiverAdvice = decodeEnvelope(body(league, clock))

    /** The D/ST chip's own read at the week's clock (the route's position query). */
    fun defBody(): String = body(FFPC, "DEF-$WEEK")

    fun plan(league: String): HostMovePlan = decodeEnvelope(File(inseason, "claim-plan-$league.json").readText())

    fun made(league: String): HostMoveResult = decodeEnvelope(File(inseason, "claim-move-$league.json").readText())

    /** The parity file the web's readers wrote (shared/scripts/waivers-parity.ts). */
    fun parity(): String = File(System.getProperty("fixtures"), "parity/waivers.json").readText()
}

/** An answer as the API sends it: the envelope around the data, every null written. */
fun envelopeOf(advice: WaiverAdvice): String =
    """{"ok":true,"data":${CommishRequestJson.encodeToString(WaiverAdvice.serializer(), advice)},"error":null}"""
