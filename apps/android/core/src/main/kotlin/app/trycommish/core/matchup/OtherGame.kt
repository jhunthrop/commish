package app.trycommish.core.matchup

import app.trycommish.api.models.LeagueMatchup
import app.trycommish.api.models.MatchupBox
import app.trycommish.api.models.MatchupSide
import app.trycommish.api.models.Scoreboard
import app.trycommish.design.Words

/** Any game of the week on the Matchup (web/src/lib/league/box/game.ts, Lane 204): the member's score bug
 * opens the member's game, every other bug the game of its first side's roster. Whose game a box is comes
 * from the box's own word (MatchupBox.viewer_side), never from the scoreboard; the score of another
 * team's game is the scoreboard's. */
object OtherGame {
    /** game.ts isOtherGame: an answer from before Lane 204 sends no viewer_side and is always the member's
     * game. */
    fun isOther(box: MatchupBox?): Boolean = box?.viewerSide == MatchupBox.ViewerSide.other

    /** game.ts otherGame: another team's game as the Matchup draws its head and score, its sides in the
     * box's order, each with the box's flags and the scoreboard's points (unread where the scoreboard was
     * not read or lists no such side), no starters of the platform's own read, as the box holds every row.
     * Null where the box is the member's game or has no side. */
    fun matchup(
        box: MatchupBox?,
        board: Scoreboard?,
    ): LeagueMatchup? {
        if (box == null || !isOther(box)) return null
        val scored =
            board
                ?.games
                .orEmpty()
                .flatMap { it.sides }
                .associateBy { it.rosterId }
        val sides =
            box.sides.map { side ->
                val read = scored[side.rosterId]
                MatchupSide(
                    rosterId = side.rosterId,
                    points = read?.points ?: 0.0,
                    playerPoints = side.playerPoints,
                    teamTotal = side.teamTotal,
                    pointsRead = read?.pointsRead ?: false,
                    starters = emptyList(),
                )
            }
        val mine = sides.firstOrNull() ?: return null
        return LeagueMatchup(week = box.week, mine = mine, opponent = sides.getOrNull(1))
    }
}

/** The head of another team's game (MatchupPanel.svelte's whose line): "Their game", and the way back to
 * the member's own. */
data class GameWhose(
    val head: String,
    val link: String,
) {
    companion object {
        val theirs = GameWhose(Words.Matchup.theirGame, Words.Matchup.yourGame)
    }
}
