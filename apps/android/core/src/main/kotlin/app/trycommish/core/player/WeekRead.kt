package app.trycommish.core.player

import app.trycommish.api.models.RunReadsDue
import app.trycommish.api.models.RunWeekRead
import app.trycommish.core.start.GameRead
import app.trycommish.design.Words
import kotlin.math.abs
import kotlin.math.floor

/** The week's read as the page and the sheet show it (web/src/lib/player/week-read.ts shownWeekRead):
 * the writer's words with their caption, or a withheld read's words alone. */
sealed interface ShownRead {
    data class Written(
        val body: String,
        val caption: String,
    ) : ShownRead

    data class Withheld(
        val words: String,
    ) : ShownRead
}

/** What the read is held to (week-read.ts CardProjection): the week's published projection as the card
 * prints it, in the card's scoring, and his game's state by its line's field at the card's clock. */
data class CardProjection(
    val week: Int,
    /** The card reads in PPR, the scoring the read quotes. */
    val ppr: Boolean,
    val points: Double?,
    /** His game's state, null for a bye or a week with no game held. */
    val state: GameRead?,
)

/** The figure a read quotes: none named on a run older than the field, none when the read was written
 * without one, or its points. The API's spec reads an absent and a null projection alike, so a read that
 * carries the moved caption (the field the projection arrived with, Lane 162) and no projection was
 * written without one. */
sealed interface QuotedProjection {
    data object NotNamed : QuotedProjection

    data object None : QuotedProjection

    data class Points(
        val points: Double,
    ) : QuotedProjection

    companion object {
        fun of(read: RunWeekRead): QuotedProjection =
            read.projection?.let { Points(it.toDouble()) } ?: if (read.movedCaption == null) NotNamed else None
    }
}

/** The projection's move, one fact for the Proj change tile, the moved caption and the run's serve rule
 * (card.ts ProjectionMove): its signed change (null with no figures to subtract), whether it reaches the
 * shown threshold, and what it is measured from. */
data class ProjectionMove(
    val change: Double?,
    val crosses: Boolean,
    val basis: Basis,
) {
    enum class Basis { Read, Earlier }

    companion object {
        /** card.ts SHOWN_CHANGE_FROM. */
        private const val SHOWN_FROM = 0.5
        private const val TENTHS = 10.0
        private const val HALF = 0.5

        /** card.ts projectionMove: since the read was written when it quotes a figure, else since the
         * earlier snapshot, in whole printed tenths so no float edge decides. */
        fun of(
            now: Double?,
            quoted: QuotedProjection,
            earlier: Double?,
        ): ProjectionMove =
            when (quoted) {
                QuotedProjection.NotNamed ->
                    ProjectionMove(earlier, earlier?.let { crossesShown(jsRound(it * TENTHS)) } ?: false, Basis.Earlier)
                QuotedProjection.None -> ProjectionMove(null, now != null, Basis.Read)
                is QuotedProjection.Points -> {
                    if (now == null) {
                        ProjectionMove(null, true, Basis.Read)
                    } else {
                        val moved = jsRound(now * TENTHS) - jsRound(quoted.points * TENTHS)
                        ProjectionMove(moved / TENTHS, crossesShown(moved), Basis.Read)
                    }
                }
            }

        private fun crossesShown(tenthsMoved: Double): Boolean = abs(tenthsMoved) >= SHOWN_FROM * TENTHS

        /** JavaScript's Math.round: half up, toward positive infinity. */
        private fun jsRound(value: Double): Double = floor(value + HALF)
    }
}

/** week-read.ts: the read beside the card's live projection, and the place's words when none stands. */
object WeekReads {
    /** shownWeekRead: a read the run withheld keeps its caption while his game is to come and says it was
     * not written once his game is under way; a read the card's projection has moved past by the shown
     * threshold is withheld behind the run's moved caption; otherwise it stands. */
    fun shown(
        read: RunWeekRead,
        card: CardProjection?,
    ): ShownRead {
        val body = read.body ?: return ShownRead.Withheld(withheldWords(read, card))
        val moved = read.movedCaption
        if (movedPastRead(read, card) && moved != null) return ShownRead.Withheld(moved)
        return ShownRead.Written(body, read.caption)
    }

    /** movedPastRead: the one test the read's withhold and the Wk tile's quote share. */
    internal fun movedPastRead(
        read: RunWeekRead,
        card: CardProjection?,
    ): Boolean {
        if (read.body == null || card == null || !card.ppr || card.week != read.week || underway(card.state)) return false
        val quoted = QuotedProjection.of(read)
        if (quoted == QuotedProjection.NotNamed || read.movedCaption == null) return false
        return ProjectionMove.of(card.points, quoted, null).crosses
    }

    /** noReadWords: his next game while it is to come, never "next" for one under way or final; while the
     * coming week's reads are not yet written, the night they are (Lane 256, the run's `weekReadsDue`). */
    fun noRead(
        state: GameRead?,
        due: RunReadsDue?,
    ): String =
        when {
            underway(state) -> Words.Card.readNotWritten
            due == null || due.night == RunReadsDue.Night.unknown_default_open_api -> Words.Card.readNotYet
            else -> readsDue(due.week, due.night.value)
        }

    /** card.ts CARD.readsDue: "Our reads for week 8 are written Tuesday night." */
    internal fun readsDue(
        week: Int,
        night: String,
    ): String = "Our reads for week $week are written $night night."

    private fun withheldWords(
        read: RunWeekRead,
        card: CardProjection?,
    ): String = if (card?.week == read.week && underway(card.state)) Words.Card.readNotWritten else read.caption

    private fun underway(state: GameRead?): Boolean = state == GameRead.KickedOff || state == GameRead.Final
}
