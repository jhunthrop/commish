package app.trycommish.core.start

import app.trycommish.api.models.WeekDoneState
import app.trycommish.core.Format
import app.trycommish.core.leaguehome.HostWords
import app.trycommish.design.Words
import kotlin.math.abs

/** The strip's figure (lineup.ts StripSum): "98.9" over "Proj with them, 74.7 as set on FFPC" and its
 * gain, or once every starter has kicked off the points so far with the projected final beside. */
data class StripSum(
    val figure: String,
    val words: String,
    val gain: String?,
    val final: String?,
)

/** The words the Start screen builds from data, each the same-named function of the web's (lineup.ts,
 * move.ts, words.ts), held to its output by shared/fixtures/parity/lineup.json. */
object StartWords {
    private val numberWords = listOf("No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine")
    private const val MINUS = "−"

    /** box.ts boxNumber: one decimal as the API rounded it, "--" when not held. */
    fun number(value: Double?): String {
        if (value == null) return Words.Box.none
        val text = Format.number(value)
        return if ('.' in text) text else "$text.0"
    }

    /** box.ts deltaWord: "+0.4", "−0.3", "0.0", "--". */
    fun delta(value: Double?): String {
        if (value == null) return Words.Box.none
        if (value == 0.0) return Format.fixed(0.0, 1)
        val magnitude = Format.fixed(abs(value), 1)
        return if (value < 0 && magnitude.toDouble() != 0.0) "$MINUS$magnitude" else "+$magnitude"
    }

    /** lineup.ts changesTitle: "Three changes", "One change", "Your lineup is set"; "Locked" while the
     * matchup still plays once every starter has kicked off, "Final" once it is. */
    fun changesTitle(
        count: Int,
        done: String?,
        state: WeekDoneState?,
    ): String =
        when {
            done != null -> if (state == WeekDoneState.locked) Words.Box.locked else Words.Box.final
            count == 0 -> Words.Lineup.set
            else -> changeCount(count)
        }

    /** words.ts changeCount: "Three changes", "One change", "12 changes". */
    fun changeCount(count: Int): String {
        val word = numberWords.getOrNull(count) ?: count.toString()
        return "$word ${if (count == 1) "change" else "changes"}"
    }

    /** lineup.ts asSetWords: "as set on ESPN", the platform placed by its own words (Lane 310). */
    private fun asSet(place: HostWords): String = "as set ${place.placed}"

    /** lineup.ts lineupSum: the strip's figure with the platform named. */
    fun lineupSum(
        box: LineupBox,
        host: HostWords,
        done: String?,
    ): StripSum? {
        if (done == null) {
            val proj = box.totals.proj ?: return null
            val words = asSet(host)
            if (box.swaps.isEmpty()) return StripSum(number(proj), "${Words.Box.proj} $words", null, null)
            val set = box.asSet?.let { ", ${number(it)} $words" }.orEmpty()
            val gain = box.gain?.takeIf { it > 0 }?.let { "+${Format.fixed(it, 1)}" }
            return StripSum(number(proj), "${Words.Box.proj} with them$set", gain, null)
        }
        val pts = box.totals.pts ?: return null
        val final = if (box.playing) box.totals.final?.let { "${Words.Box.projFinal} ${number(it)}" } else null
        return StripSum(number(pts), "${Words.Box.pts} ${asSet(host)}", null, final)
    }

    /** lineup.ts swapWords: "QB, Mahomes in, Rodgers out". */
    fun swap(swap: Swap): String {
        val into = "${swap.slot}, ${swap.into} ${Words.Lineup.swapIn}"
        return swap.out?.let { "$into, $it ${Words.Lineup.swapOut}" } ?: into
    }

    /** lineup.ts idleWords: "TE: no one on your roster can play this week". */
    fun idle(slot: String): String = "$slot: ${Words.Lineup.noOneCanPlay}"

    /** lineup.ts heldWords: "QB: Dart has kicked off, the spot stays empty". */
    fun held(spot: HeldSpot): String = "${LineupBoxes.slotWord(spot.slot)}: ${spot.name} ${Words.Lineup.heldEmpty}"

    /** lineup.ts lineupText: the week, then a slot and a name a line. */
    fun lineupText(
        box: LineupBox,
        week: Int,
    ): String = (listOf("Week $week lineup") + box.starters.map { "${it.row.slot} ${it.row.name}" }).joinToString("\n")

    /** lineup.ts lineupPageWords: "FFPC's lineup page". */
    fun lineupPage(platform: String): String = "$platform's lineup page"

    /** lineup.ts setOnWords: "Lineup set on ESPN". */
    fun setOn(platform: String): String = "Lineup set on $platform"

    /** box.ts teamSmallFigure: nothing before kickoff, then the projected final, then the final total. */
    fun teamSmall(totals: LineupTotals): Pair<String, Double?>? {
        if (!totals.live) return null
        return if (totals.allFinal) Words.Box.final to totals.pts else Words.Box.projFinal to totals.final
    }

    // The move (move.ts, words.ts).

    /** words.ts verbWords('start'): "Set it on ESPN". */
    fun setItOn(platform: String): String = "Set it on $platform"

    /** move.ts readingWords: "Reading your lineup on ESPN". */
    fun reading(platform: String): String = "Reading your lineup on $platform"

    /** move.ts settingWords: "Setting it on ESPN". */
    fun setting(platform: String): String = "Setting it on $platform"

    /** move.ts openHostWords: "Open ESPN". */
    fun open(platform: String): String = "Open $platform"

    /** move.ts lostWords for a lineup: the move may have left, so check the platform. */
    fun lost(platform: String): String =
        "We did not hear back, so the move may have been made. Check your lineup on $platform before you set it again."

    /** move.ts hostSaid: "ESPN said: Lineup transaction could not be completed." */
    fun platformSaid(
        platform: String,
        words: String,
    ): String {
        val said = words.trim()
        val stop = if (said.lastOrNull()?.let { it in ".!?" } == true) "" else "."
        return "$platform said: $said$stop"
    }
}
