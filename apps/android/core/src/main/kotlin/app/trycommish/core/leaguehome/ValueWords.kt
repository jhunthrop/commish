package app.trycommish.core.leaguehome

import app.trycommish.api.models.LeagueHost
import app.trycommish.api.models.LeagueMove
import app.trycommish.api.models.Tiebreak
import app.trycommish.api.models.WaiverOrder
import app.trycommish.core.AppWords
import app.trycommish.design.Words

/**
 * An API value in the web's words: a value this build knows reads its generated word (Words, from the
 * web's tables by shared/scripts/gen-words.ts); one it does not know (the generated client's unknown
 * default, an API newer than the app) reads a neutral word, never a crash and never a code. The web
 * indexes its tables by the value; these are those lookups.
 */
object ValueWords {
    /** names.ts hostWords (HOST_WORDS[host]): the platform named, never "host". */
    fun platform(host: LeagueHost): String =
        when (host) {
            LeagueHost.sleeper -> Words.Platform.sleeper
            LeagueHost.mfl -> Words.Platform.mfl
            LeagueHost.ffpc -> Words.Platform.ffpc
            LeagueHost.yahoo -> Words.Platform.yahoo
            LeagueHost.espn -> Words.Platform.espn
            else -> AppWords.unknownPlatform
        }

    /** home.ts KIND_WORDS[kind]; a kind this build does not know is the plain word Move. */
    fun moveKind(kind: LeagueMove.Kind): String =
        when (kind) {
            LeagueMove.Kind.add -> Words.MoveKind.add
            LeagueMove.Kind.waiver -> Words.MoveKind.waiver
            LeagueMove.Kind.trade -> Words.MoveKind.trade
            else -> Words.LeagueHome.move
        }

    /** home.ts TIEBREAK_WORDS[rule]; null for a rule this build does not know, said as no rule stated. */
    fun tiebreak(rule: Tiebreak): String? =
        when (rule) {
            Tiebreak.head_to_head -> Words.Tiebreak.head_to_head
            Tiebreak.points_for -> Words.Tiebreak.points_for
            Tiebreak.points_against -> Words.Tiebreak.points_against
            Tiebreak.division_record -> Words.Tiebreak.division_record
            else -> null
        }

    /** home.ts WAIVER_ORDER_WORDS[order]; null for an order this build does not know. */
    fun waiverOrder(order: WaiverOrder): String? =
        when (order) {
            WaiverOrder.rolling -> Words.WaiverOrder.rolling
            WaiverOrder.inverse_standings -> Words.WaiverOrder.inverse_standings
            else -> null
        }
}
