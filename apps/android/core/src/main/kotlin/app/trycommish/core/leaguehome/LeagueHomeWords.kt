package app.trycommish.core.leaguehome

import app.trycommish.api.models.LeagueHost
import app.trycommish.api.models.LeagueMove
import app.trycommish.api.models.Tiebreak
import app.trycommish.api.models.WaiverOrder

/**
 * The League home's words that shared/words does not carry yet: the box score's heads and the moves'
 * kinds, ported by hand from the web (web/src/lib/league/box/box.ts BOX, box/kickoff.ts KICKOFF,
 * home/home.ts KIND_WORDS, TIEBREAK_WORDS, WAIVER_ORDER_WORDS, names.ts HOST_WORDS), and the app's
 * own words for its cache and its failure. The page's own words are Words.LeagueHome, generated.
 * The copy guard (app/src/test CopyGuardTest) reads every string here.
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

    /** The stamp of an answer just read, and of one kept from before while the API cannot be reached. */
    const val read = "Read"
    const val offline = "No connection, showing the read of"

    /** A member with no league attached yet: where to attach one. */
    const val noLeague = "Attach a league from ESPN, Sleeper, Yahoo, MyFantasyLeague or FFPC at trycommish.app, then pull down here."

    /** With nothing kept and no connection: what happened and what to do, never an error code. */
    const val cannotLoad = "We could not reach Commish. Check your connection, then pull down to try again."

    /** The platform as a sentence names it. */
    fun platform(host: LeagueHost): String =
        when (host) {
            LeagueHost.sleeper -> "Sleeper"
            LeagueHost.mfl -> "MyFantasyLeague"
            LeagueHost.ffpc -> "FFPC"
            LeagueHost.yahoo -> "Yahoo"
            LeagueHost.espn -> "ESPN"
            LeagueHost.unknown_default_open_api -> "your platform"
        }

    fun kind(kind: LeagueMove.Kind): String =
        when (kind) {
            LeagueMove.Kind.add -> freeAgent
            LeagueMove.Kind.waiver -> waiver
            LeagueMove.Kind.trade -> trade
            LeagueMove.Kind.unknown_default_open_api -> freeAgent
        }

    /** The rule a tie on record is broken by, as the standings' basis says it. */
    fun tiebreak(tiebreak: Tiebreak): String? =
        when (tiebreak) {
            Tiebreak.head_to_head -> "head to head"
            Tiebreak.points_for -> "points for"
            Tiebreak.points_against -> "points against"
            Tiebreak.division_record -> "division record"
            Tiebreak.unknown_default_open_api -> null
        }

    /** How an order league's waiver order moves. */
    fun waiverOrder(order: WaiverOrder): String? =
        when (order) {
            WaiverOrder.rolling -> "rolling"
            WaiverOrder.inverse_standings -> "reverse standings"
            WaiverOrder.unknown_default_open_api -> null
        }
}
