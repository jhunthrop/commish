package app.trycommish.core.waivers

import app.trycommish.api.models.HostBid
import app.trycommish.api.models.HostMoveResult
import app.trycommish.api.models.WaiverAdvice
import app.trycommish.api.models.WaiverMoves
import app.trycommish.core.Format
import app.trycommish.core.instantOrNull
import app.trycommish.core.leaguehome.HostWords
import app.trycommish.core.start.StartRows
import app.trycommish.design.Words
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException
import java.util.Locale
import kotlin.math.abs

/** What the copy verb said: "Copied Gainwell. Add him on" and the page's words, "ESPN's waiver page". */
data class CopiedWords(
    val said: String,
    val page: String,
)

/** The words the Waivers screen builds from data, each the same-named function of the web's (waivers.ts,
 * move.ts, words.ts, next-week.ts), held to its output by shared/fixtures/parity/waivers.json as the iOS
 * port is. */
object WaiverWords {
    private val numberWords = listOf("No", "One", "Two", "Three")
    private const val MINUS = "−"
    private val shortWeekday = DateTimeFormatter.ofPattern("EEE", Locale.US)
    private val hostId = Regex("^-?[0-9]{1,12}$")
    private val wholeBid = Regex("^[+-]?[0-9]+(\\.0*)?$")

    // Figures.

    /** Whether a gain is one the page prints above zero. */
    fun positive(gain: Double): Boolean = Format.fixed(gain, 1).toDouble() > 0

    /** waivers.ts gainWord: "+6.7", "−0.5", "0.0". */
    fun gain(gain: Double): String {
        val shown = Format.fixed(gain, 1).toDouble()
        if (shown == 0.0) return Format.fixed(0.0, 1)
        val magnitude = Format.fixed(abs(shown), 1)
        return if (shown < 0 && magnitude.toDouble() != 0.0) "$MINUS$magnitude" else "+$magnitude"
    }

    /** waivers.ts beatsWord: "+0.3 Gain" on a row that gains, the bare "0.0" on one that does not, "--"
     * on a row the rule cannot judge. */
    fun beats(
        gain: Double?,
        gains: Boolean,
    ): String {
        if (gain == null) return Words.Box.none
        return if (gains) "${gain(gain)} ${Words.Season.gain}" else gain(gain)
    }

    /** waivers.ts beatsPlace: "Starter", "Starter, bye" or "Bench". */
    fun beatsPlace(
        starter: Boolean,
        bye: Boolean,
    ): String =
        when {
            !starter -> Words.Waivers.bench
            bye -> "${Words.Waivers.starter}, ${Words.Waivers.onBye}"
            else -> Words.Waivers.starter
        }

    /** waivers.ts beatsWeekWord: "+4.8 Proj". */
    fun beatsWeek(week: Double): String = "${gain(week)} ${Words.Box.proj}"

    /** waivers.ts cardGains: "+6.7 Proj this week, +1.2 Gain a week", the Gain alone once the week figure
     * is gone. */
    fun cardGains(
        week: Double?,
        gain: Double,
    ): String {
        val season = "${gain(gain)} ${Words.Waivers.gain}"
        return week?.let { "${gain(it)} ${Words.Waivers.thisWeek}, $season" } ?: season
    }

    // Names.

    /** waivers.ts shortName: the last name, a defense by its club. */
    fun shortName(name: String): String = StartRows.lastName(StartRows.withoutDefense(name))

    /** waivers.ts cardName: the last name, or the whole name where another on the screen shares it. */
    fun cardName(
        name: String,
        onScreen: List<String>,
    ): String {
        val short = shortName(name)
        val sharing = onScreen.filter { shortName(it) == short }.toSet()
        return if (sharing.size > 1) name else short
    }

    /** waivers.ts beatsName: the last name, or the first initial and the last name where another player
     * on the screen shares it. */
    fun beatsName(
        name: String,
        onScreen: List<String>,
    ): String = if (cardName(name, onScreen) == name) StartRows.initialName(StartRows.withoutDefense(name)) else shortName(name)

    // The strip.

    /** waivers.ts pickupsTitle: "Two pickups", "One pickup", or the line for none. */
    fun pickupsTitle(count: Int): String {
        if (count == 0) return Words.Waivers.noPickup
        val word = numberWords.getOrNull(count) ?: count.toString()
        return "$word ${if (count == 1) "pickup" else "pickups"}"
    }

    /** waivers.ts moveWords: "Add Gainwell, drop Lemon", or "Add Gainwell" into an open spot. */
    fun move(
        add: String,
        drop: String?,
    ): String = drop?.let { "${Words.InSeason.add} $add, drop $it" } ?: "${Words.InSeason.add} $add"

    /** waivers.ts dropWhyWords: "(IR, on your bench)". */
    fun dropWhy(why: String?): String? = why?.let { "($it)" }

    /** waivers.ts stripDecision: the strip's sentence for TalkBack. */
    fun decision(cards: List<PickupCard>): String {
        val said = cards.map { card -> card.why?.let { "${card.move} $it" } ?: card.move }
        return (listOf(pickupsTitle(cards.size)) + said).joinToString(". ") + "."
    }

    // The drop panel.

    /** waivers.ts dropTitle: "Drop one for Kenny Gainwell". */
    fun dropTitle(name: String): String = "Drop one for $name"

    /** waivers.ts dropLead: "+6.7 Proj this week with any of them. The one you lose least by comes first." */
    fun dropLead(week: Double?): String {
        val first = "The one you lose least by comes first."
        return week?.let { "${gain(it)} ${Words.Waivers.thisWeek} with any of them. $first" } ?: first
    }

    // The verbs.

    /** waivers.ts openWaiversWords: "Open ESPN waivers", the platform's own page by its words (Lane 310). */
    fun openWaivers(place: HostWords): String = "Open ${place.own("waivers")}"

    /** waivers.ts addOnWords: "Add on ESPN", the platform placed by its own words (Lane 310). */
    fun addOn(place: HostWords): String = "${Words.InSeason.add} ${place.placed}"

    /** move.ts claimsAdd: the API opens claims for the league and names him by an id the route takes. */
    fun claimsAdd(
        moves: WaiverMoves,
        hostId: String,
    ): Boolean = moves.claim == WaiverMoves.Claim.available && this.hostId.matches(hostId)

    /** waivers.ts addVerbWords: "Add on ESPN" where the claim is made from here, else "Open ESPN waivers". */
    fun addVerb(
        moves: WaiverMoves,
        hostId: String,
        host: HostWords,
    ): String = if (claimsAdd(moves, hostId)) addOn(host) else openWaivers(host)

    /** waivers.ts copiedWords: "Copied Gainwell. Add him on" and "ESPN's waiver page". */
    fun copied(
        platform: String,
        name: String,
        didCopy: Boolean,
    ): CopiedWords =
        CopiedWords(
            if (didCopy) "${Words.Waivers.copied} $name. Add him on" else "${Words.Waivers.copyFailed} Add him on",
            "$platform's waiver page",
        )

    /** waivers.ts clearsWords: "Clears Wed" from the platform's calendar day; null without one. */
    fun clears(day: String?): String? {
        if (day == null) return null
        return try {
            "${Words.Waivers.clears} ${shortWeekday.format(LocalDate.parse(day))}"
        } catch (e: DateTimeParseException) {
            null
        }
    }

    // The heads and the Stash group.

    /** waivers.ts backWords: "Back this week" in the week the page addresses, else "Back week 9". */
    fun back(
        week: Int,
        addressed: Int,
    ): String = if (week == addressed) Words.Stash.backNow else "Back week $week"

    /** waivers.ts headBasis and headBasisText: "A game is our rest-of-season points a game, Avg his season
     * average, Δ Proj his Proj's change since Thu 9:00 pm, Beats the player he would replace in your
     * rest-of-season lineup." */
    fun heads(
        previousReadAt: String?,
        projected: Boolean,
        zone: ZoneId,
    ): String {
        val delta =
            if (projected) {
                instantOrNull(previousReadAt)?.let {
                    "${Words.Box.delta} his ${Words.Box.proj}'s change since ${Format.weekdayTime(it, zone)}"
                }
            } else {
                null
            }
        val parts =
            listOfNotNull(
                "${Words.Waivers.rest} ${Words.WaiverHeads.rest}",
                "${Words.Box.avg} ${Words.WaiverHeads.avg}",
                delta,
                "${Words.Waivers.beats} ${Words.WaiverHeads.beats}",
            )
        return parts.joinToString(Words.WaiverHeads.separator) + "."
    }

    /** waivers.ts stashBasis: the Stash group's line, empty with nothing to say. */
    fun stashLine(advice: WaiverAdvice): List<String> {
        val rows = advice.stash.orEmpty().isNotEmpty()
        val late = (advice.stashLate ?: 0) > 0
        val taken = advice.regularSeasonTaken?.takeIf { rows || late }?.let { "Regular season taken as weeks 1 to $it." }
        return listOfNotNull(
            if (rows) Words.Stash.line else null,
            if ((advice.stashUndated ?: 0) > 0) Words.Stash.undated else null,
            if (late) Words.Stash.late else null,
            taken,
        )
    }

    /** next-week.ts arrivesPart: "Week 7 projections expected Thursday.", null once read or with no time. */
    fun arrives(
        advice: WaiverAdvice,
        zone: ZoneId,
    ): String? {
        if (advice.projectionReadAt != null) return null
        val arrival = instantOrNull(advice.projectionArrivesAt) ?: return null
        return "Week ${advice.forWeek ?: advice.week} projections expected ${Format.weekdayName(arrival, zone)}."
    }

    // The claim (move.ts, words.ts).

    /** words.ts verbWords('waivers'): "Claim on ESPN". */
    fun claimOn(platform: String): String = "Claim on $platform"

    /** move.ts readingWords for a claim: "Reading your roster on ESPN". */
    fun reading(platform: String): String = "Reading your roster on $platform"

    /** move.ts settingWords for a claim: "Claiming on ESPN". */
    fun claiming(platform: String): String = "Claiming on $platform"

    /** move.ts lostWords for a claim. */
    fun lost(platform: String): String =
        "We did not hear back, so the claim may have been made. Check your claims on $platform before you claim again."

    /** move.ts resultWords: the API's sentence, or for a claim the platform's queue holds with when it runs,
     * that time on the member's clock. */
    fun result(
        platform: String,
        result: HostMoveResult,
        zone: ZoneId,
    ): String {
        val runs = instantOrNull(result.processesAt)
        if (result.outcome != HostMoveResult.Outcome.pending || runs == null) return result.sentence
        return "Claim submitted. $platform processes it ${Format.weekdayTime(runs, zone)}, " +
            "and your lineup screen will show him once it goes through."
    }

    /** move.ts bidLabel: "Your bid in waiver dollars, $0 to $87, what your team has left". */
    fun bidLabel(bid: HostBid): String {
        val basis = if (bid.leftKnown) "what your team has left" else "the league's budget"
        return "Your bid in waiver dollars, \$${bid.min} to \$${bid.max}, $basis"
    }

    /** move.ts bidProblem: a typed bid the league does not take, in the platform's terms; null for a whole
     * number in bounds. */
    fun bidProblem(
        platform: String,
        typed: String,
        bid: HostBid,
    ): String? {
        val value = bidValue(typed.trim())
        if (value != null && value >= bid.min && value <= bid.max) return null
        return "$platform takes bids from \$${bid.min} to \$${bid.max} in this league."
    }

    /** A typed bid as a whole number: digits with an optional sign; null else. Stricter than JavaScript's
     * Number, which also takes "1e1" or "0x0A" (the iOS review's L3): the number pad types neither. */
    fun bidValue(typed: String): Int? {
        if (typed.isEmpty() || !wholeBid.matches(typed)) return null
        return typed.toDoubleOrNull()?.takeIf { it == Math.floor(it) && abs(it) <= Int.MAX_VALUE }?.toInt()
    }
}
