package app.trycommish.core.trades

import app.trycommish.api.CommishRequestJson
import app.trycommish.api.decodeEnvelope
import app.trycommish.api.models.TradeAdvice
import app.trycommish.api.models.TradeCheck
import app.trycommish.core.leaguehome.Fixtures
import java.io.File

/** The shared fixture league's trades (GET /leagues/attached/{id}/trades) at its six clocks as the API
 * sends them, the trades holding Aaron Rodgers at the week's clock (`?player=8439`), and the check of each
 * strip trade at the week's and the Sunday's clocks (POST .../trades/check), as Lane 189 exported them
 * (shared/fixtures/README.md). */
object TradeFixtures {
    const val LEAGUE = Fixtures.LEAGUE_ID

    /** Saturday noon: the finder before any Sunday kickoff. */
    const val WEEK = "2026-10-17T17-00-00Z"

    /** Sunday 18:56Z: the noon games in play. */
    const val SUNDAY = "2026-10-18T18-56-00Z"

    /** The board id the holding fixture narrows to (Aaron Rodgers). */
    const val RODGERS = "8439"

    /** The best trade's key at the week's clock: Rodgers to Max_Jensen10 for Waddle and Strong. */
    const val BEST = "8:96>7526+8116"

    private val inseason = File(System.getProperty("fixtures"), "inseason")

    fun body(clock: String = WEEK): String = File(inseason, "trades-$LEAGUE-$clock.json").readText()

    fun trades(clock: String = WEEK): TradeAdvice = decodeEnvelope(body(clock))

    fun holdingBody(): String = File(inseason, "trades-$LEAGUE-player-$RODGERS-$WEEK.json").readText()

    fun holding(): TradeAdvice = decodeEnvelope(holdingBody())

    /** The check of the strip's trade `number` at a clock. */
    fun check(
        clock: String = WEEK,
        number: Int = 1,
    ): TradeCheck = decodeEnvelope(File(inseason, "trade-check-$LEAGUE-$clock-$number.json").readText())

    /** The parity file the web's readers wrote (shared/scripts/trades-parity.ts). */
    fun parity(): String = File(System.getProperty("fixtures"), "parity/trades.json").readText()
}

/** An answer as the API sends it: the envelope around the data, every null written. */
fun envelopeOf(advice: TradeAdvice): String =
    """{"ok":true,"data":${CommishRequestJson.encodeToString(TradeAdvice.serializer(), advice)},"error":null}"""
