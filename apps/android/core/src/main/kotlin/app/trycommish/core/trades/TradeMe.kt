package app.trycommish.core.trades

import app.trycommish.core.Format
import app.trycommish.core.shell.FollowedLeague
import app.trycommish.design.Words

/** The member's side as the builder names it: the team and where it stands. */
data class TradeMe(
    val name: String,
    val aside: String,
) {
    companion object {
        /** The followed league's team and standing (TradeScreen's me: the switch's team name and model.ts
         * standingWords, "5-1, 2nd of 12"); "You" for a league whose team is unread. */
        fun of(league: FollowedLeague): TradeMe {
            val aside =
                league.standing?.let {
                    val record = "${it.wins}-${it.losses}"
                    val words = if (it.ties > 0) "$record-${it.ties}" else record
                    "$words, ${Format.ordinal(it.place)} of ${it.teams}"
                }
            return TradeMe(league.teamName.ifEmpty { Words.Box.you }, aside.orEmpty())
        }
    }
}
