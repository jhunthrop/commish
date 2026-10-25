package app.trycommish.core.player

import app.trycommish.api.models.DesignationStatus
import app.trycommish.api.models.RunBoardRow
import app.trycommish.api.models.RunCapsule
import app.trycommish.api.models.RunClub
import app.trycommish.api.models.RunFormat
import app.trycommish.api.models.RunPlayerFormat
import app.trycommish.core.Format
import app.trycommish.core.board.RunWords
import app.trycommish.core.instantOrNull
import app.trycommish.design.Words
import kotlin.math.abs
import kotlin.math.max

/** A format line's sentences as the player page prints them (web/src/lib/run/player-words.ts LineWords):
 * the big figure's caption, where drafters take him (its label, figure and sentence) and his value among
 * the board. */
data class LineWords(
    val caption: String,
    val draftersLabel: String,
    val draftersFigure: String,
    val drafters: String,
    val value: String,
)

/** His numbers in a format, from his page or, for a page held with no copy, the board's row. */
data class LineNumbers(
    val positionRank: Int,
    val ourRank: Int,
    val vorRound: Int,
    val adp: Double?,
    val gap: Double?,
    val projected: Double,
    val vor: Double,
    val expectedGames: Double,
    val floor: Double?,
    val median: Double?,
    val ceiling: Double?,
) {
    companion object {
        fun of(numbers: RunPlayerFormat): LineNumbers =
            LineNumbers(
                numbers.positionRank,
                numbers.ourRank,
                numbers.vorRound,
                numbers.adp?.toDouble(),
                numbers.gap?.toDouble(),
                numbers.projected.toDouble(),
                numbers.vor.toDouble(),
                numbers.expectedGames.toDouble(),
                numbers.floor?.toDouble(),
                numbers.median?.toDouble(),
                numbers.ceiling?.toDouble(),
            )

        fun of(row: RunBoardRow): LineNumbers =
            LineNumbers(
                row.positionRank,
                row.ourRank,
                row.vorRound,
                row.adp?.toDouble(),
                row.gap?.toDouble(),
                row.projected.toDouble(),
                row.vor.toDouble(),
                row.expectedGames.toDouble(),
                row.floor?.toDouble(),
                row.median?.toDouble(),
                row.ceiling?.toDouble(),
            )
    }
}

/** player-words.ts and the page's other built words, ported and held to
 * shared/fixtures/parity/player-sheet.json's pages. */
object PageWords {
    /** rest-from.ts RUN_LAST_WEEK: the run's figure stops at its last week. */
    const val RUN_LAST_WEEK = 17
    private const val BELOW_THE_AVAILABLE = "He sits below the available players."
    private const val NO_SOURCE = "None of our ADP sources has him."

    /** The run ranks the rest of the season in this format (rest-words.ts restLead is not null). */
    fun ranksRest(format: RunFormat): Boolean = format.rosFromWeek != null && format.refreshedAt != null

    /** The season a line is said in (player-words.ts lineWords' season): its year, whether the run is under
     * way, and whether he is on a season-long list. */
    data class Season(
        val year: Int,
        val underway: Boolean,
        val heldOut: Boolean,
    )

    /** player-words.ts lineWords. */
    fun line(
        format: RunFormat,
        numbers: LineNumbers,
        sources: List<String>,
        boardSize: Int?,
        season: Season,
    ): LineWords {
        val inSeason = ranksRest(format)
        val year = season.year.toString()
        val rank = if (season.heldOut) " if he plays, below the available players" else ", our rank ${numbers.ourRank}"
        val through = max(RUN_LAST_WEEK, format.rosFromWeek ?: RUN_LAST_WEEK)
        val games = Format.fixed(numbers.expectedGames)
        val caption =
            when {
                inSeason -> "${format.label} points for the rest of $year through week $through$rank"
                season.underway -> "${format.label} points in $year, projected preseason over $games games"
                else -> "projected ${format.label} points in $year, over $games expected games"
            }
        val fact = draftersFact(numbers, inSeason || season.heldOut)
        val size = boardSize?.toString() ?: Words.Box.none
        return LineWords(
            caption = caption,
            draftersLabel = fact.first,
            draftersFigure = fact.second,
            drafters = if (season.heldOut) heldDrafters(numbers, sources) else drafters(numbers, sources, inSeason),
            value = if (season.heldOut) heldValue(size, inSeason) else value(numbers, size, inSeason),
        )
    }

    /** draftersWords: where drafters take him against our rank, or in season his ADP alone. */
    private fun drafters(
        numbers: LineNumbers,
        sources: List<String>,
        inSeason: Boolean,
    ): String {
        val from = sources.joinToString(" and ")
        if (inSeason) return if (numbers.adp == null) NO_SOURCE else "His ADP in $from, before the season."
        val pick = "We have him at pick ${numbers.ourRank}"
        val adp = numbers.adp ?: return "None of our ADP sources has him yet. $pick."
        val said = "ADP ${Format.fixed(adp)} from $from."
        val gap = numbers.gap ?: return "$pick. $said"
        val place = if (gap == 0.0) "drafters take him right where we would" else "drafters take him ${gapPicks(gap)}"
        return "$pick, so $place. $said"
    }

    /** gap-picks.ts gapPicks: "3.5 picks later", "1.0 pick earlier". */
    private fun gapPicks(gap: Double): String {
        val picks = abs(gap)
        return "${Format.fixed(picks)} ${if (picks == 1.0) "pick" else "picks"} ${if (gap > 0) "later" else "earlier"}"
    }

    private fun draftersFact(
        numbers: LineNumbers,
        inSeason: Boolean,
    ): Pair<String, String> {
        val place = "Where drafters take him"
        val adp = numbers.adp ?: return (if (inSeason) Words.Board.adp else place) to "No ADP"
        return if (inSeason) Words.Board.adp to Format.fixed(adp) else place to "Pick ${Format.fixed(adp, 0)}"
    }

    private fun heldDrafters(
        numbers: LineNumbers,
        sources: List<String>,
    ): String {
        val adp = numbers.adp?.let { "ADP ${Format.fixed(it)} from ${sources.joinToString(" and ")}." } ?: NO_SOURCE
        return "$adp $BELOW_THE_AVAILABLE"
    }

    private fun heldValue(
        size: String,
        inSeason: Boolean,
    ): String = "If he plays, among the $size on our board${if (inSeason) " for the rest of the season" else ""}. $BELOW_THE_AVAILABLE"

    private fun value(
        numbers: LineNumbers,
        size: String,
        inSeason: Boolean,
    ): String =
        when {
            numbers.vor < 0 && inSeason -> "Below replacement for the rest of the season, among the $size on our board"
            numbers.vor < 0 -> "Below replacement, among the $size on our board"
            inSeason -> "Our rank ${numbers.ourRank} of the $size on our board for the rest of the season"
            else -> "Round ${numbers.vorRound} value among the $size on our board"
        }

    /** heldTierWords: the list he is on and that he is not ranked; null for a week's designation. */
    fun heldTier(status: DesignationStatus): String? =
        when (status) {
            DesignationStatus.injured_reserve -> "On IR, not ranked"
            DesignationStatus.pup -> "On PUP, not ranked"
            DesignationStatus.nfi -> "On NFI, not ranked"
            DesignationStatus.suspended -> "Suspended, not ranked"
            DesignationStatus.out -> "Out for the season, not ranked"
            DesignationStatus.questionable, DesignationStatus.doubtful, DesignationStatus.unknown_default_open_api -> null
        }

    /** page-words.ts PLAYER_PAGE.outcomesCaption: "2026 PPR points, from his low case to his high case". */
    fun outcomesCaption(
        season: Int,
        scoring: String,
    ): String = "$season $scoring points, from his low case to his high case"

    /** player-card.ts readStamp: "Written Oct 13, from his facts through last season". */
    fun readStamp(capsule: RunCapsule?): String? =
        instantOrNull(capsule?.writtenAt)?.let { "Written ${Format.shortDay(it, RunWords.eastern)}, ${Words.Card.writtenFrom}" }

    /** player.ts clubNameOf: "Chicago Bears", a free agent's "FA". */
    fun clubName(
        team: String,
        clubs: List<RunClub>,
    ): String {
        if (team == Words.Figure.freeAgentClub) return team
        val club = clubs.firstOrNull { it.abbr == team } ?: return team
        return "${club.city} ${club.nickname}"
    }
}
