package app.trycommish.core.leaguehome

import app.trycommish.api.models.LeagueHost
import app.trycommish.api.models.LeagueMove
import app.trycommish.api.models.Tiebreak
import app.trycommish.api.models.WaiverOrder
import app.trycommish.design.Words

/**
 * The League home's words that shared/words does not carry yet: the box score's heads, the moves'
 * kinds, the platforms, the standings' basis, ported by hand from the web (web/src/lib/league/box/box.ts
 * BOX, box/kickoff.ts KICKOFF, home/home.ts KIND_WORDS, TIEBREAK_WORDS, WAIVER_ORDER_WORDS and
 * standingsBasis, names.ts HOST_WORDS), and the app's own words for its cache, its failure and a
 * lapsed sign-in. The page's own words are Words.LeagueHome, generated. A sentence built from data is
 * a template here, its slots in braces, filled by [fill]. The copy guard (app/src/test CopyGuardTest)
 * reads every string and every map value here. Until the shared lane extends gen-words.ts (review M5),
 * this is the one Kotlin source of these words.
 */
@Suppress("ktlint:standard:property-naming") // The keys mirror the web's word tables, as Words.LeagueHome does.
object LeagueHomeWords {
    const val proj = "Proj"
    const val pts = "Pts"
    const val projFinal = "Proj final"
    const val kickedOff = "Kicked off"
    const val none = "--"
    const val bench = "Bench"
    const val player = "player"
    const val players = "players"
    const val reserve = "Injured reserve"

    const val freeAgent = "Free agent"
    const val waiver = "Waiver"
    const val trade = "Trade"
    const val drop = "Drop"

    /** A traded player's new team: "to Dad Runners". */
    const val to = "to"

    /** A team the league's read does not name. */
    const val teamFallback = "Team {id}"

    /** The stamp of an answer read, and of one kept from before while the API cannot be reached. */
    const val read = "Read"
    const val offline = "No connection, showing the read of"

    /** A member with no league attached yet: where to attach one. */
    const val noLeague = "Attach a league from ESPN, Sleeper, Yahoo, MyFantasyLeague or FFPC at trycommish.app, then pull down here."

    /** With nothing kept and no connection: what happened and what to do, never an error code. */
    const val cannotLoad = "We could not reach Commish. Check your connection, then pull down to try again."

    /** The API no longer takes the device's sign-in (it lapsed unused, or was revoked). */
    const val signedOut = "Your sign-in on this phone has run out. Sign in again to see your leagues."

    /** The standings' basis (home.ts standingsBasis): the order and its tiebreak, PF and PA, the streak,
     * the waiver column. */
    const val standingsBasis =
        "Standings follow {platform}'s record, {after}. {pf} and {pa} are points for and against, {streak} the current run{waiver}."
    const val thenTiebreak = "then {tiebreak}"
    const val thenPointsFor = "then points for, as {platform} lists them"
    const val budgetBasis = ", {faab} the budget left{of}"
    const val budgetOf = " of {amount}"
    const val orderBasis = ", {order} the place in {platform}'s order ({how})"

    /** A platform this build does not know yet (an API newer than the app). */
    const val unknownPlatform = "your platform"

    /** The platform as a sentence names it. */
    val platforms: Map<LeagueHost, String> =
        mapOf(
            LeagueHost.sleeper to "Sleeper",
            LeagueHost.mfl to "MyFantasyLeague",
            LeagueHost.ffpc to "FFPC",
            LeagueHost.yahoo to "Yahoo",
            LeagueHost.espn to "ESPN",
        )

    /** A move's kind; a kind this build does not know is the plain word Move. */
    val kinds: Map<LeagueMove.Kind, String> =
        mapOf(
            LeagueMove.Kind.add to freeAgent,
            LeagueMove.Kind.waiver to waiver,
            LeagueMove.Kind.trade to trade,
        )

    /** The rule a tie on record is broken by, as the standings' basis says it. */
    val tiebreaks: Map<Tiebreak, String> =
        mapOf(
            Tiebreak.head_to_head to "head to head",
            Tiebreak.points_for to "points for",
            Tiebreak.points_against to "points against",
            Tiebreak.division_record to "division record",
        )

    /** How an order league's waiver order moves. */
    val waiverOrders: Map<WaiverOrder, String> =
        mapOf(
            WaiverOrder.rolling to "rolling",
            WaiverOrder.inverse_standings to "reverse standings",
        )

    fun platform(host: LeagueHost): String = platforms[host] ?: unknownPlatform

    fun kind(kind: LeagueMove.Kind): String = kinds[kind] ?: Words.LeagueHome.move

    /** Null for a rule this build does not know: the basis then says the platform's own order. */
    fun tiebreak(tiebreak: Tiebreak): String? = tiebreaks[tiebreak]

    fun waiverOrder(order: WaiverOrder): String? = waiverOrders[order]

    /** A template with its slots filled: fill("Team {id}", "id" to "7") is "Team 7". */
    fun fill(
        template: String,
        vararg slots: Pair<String, String>,
    ): String = slots.fold(template) { text, (slot, value) -> text.replace("{$slot}", value) }
}
