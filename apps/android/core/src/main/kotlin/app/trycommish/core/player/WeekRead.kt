package app.trycommish.core.player

import app.trycommish.api.models.RunReadsDue
import app.trycommish.api.models.RunWeekRead
import app.trycommish.core.Format
import app.trycommish.core.board.RunWords
import app.trycommish.core.instantOrNull
import app.trycommish.core.start.GameRead
import app.trycommish.design.Words
import java.time.Duration
import java.time.Instant
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

/** The projection's move, one fact for the Proj change tile and the run's rewrite rule
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
     * not written once his game is under way; a written read stands through any move of the published
     * projection (Lane 274). */
    fun shown(
        read: RunWeekRead,
        card: CardProjection?,
    ): ShownRead {
        val body = read.body ?: return ShownRead.Withheld(withheldWords(read, card))
        return ShownRead.Written(body, shownCaption(read, card))
    }

    /** shownCaption: a status caption says its lead alone once his game for the read's week is under way,
     * as no new read comes for a game being played (Lane 274 review M2). */
    private fun shownCaption(
        read: RunWeekRead,
        card: CardProjection?,
    ): String {
        val played = card?.week == read.week && underway(card.state)
        val lead = Words.StatusHeld.changedLead
        return if (played && read.caption.startsWith(lead)) lead else read.caption
    }

    /** noReadWords: his next game while it is to come, never "next" for one under way or final; while the
     * coming week's reads are not yet written, the night of the nightly that writes them (Lane 256, the
     * run's `weekReadsDue`), until the screen's clock passes it (Lane 265); a run from before names no
     * instant and promises nothing. */
    fun noRead(
        state: GameRead?,
        due: RunReadsDue?,
        now: Instant,
    ): String {
        if (underway(state)) return Words.Card.readNotWritten
        val week = due?.week ?: return Words.Card.readNotYet
        val at = instantOrNull(due.at) ?: return Words.Card.readNotYet
        if (!now.isBefore(at)) return Words.Card.readNotYet
        return readsDue(week, nightOf(at))
    }

    /** week-read.ts nightOf: the night a nightly belongs to, the Eastern day six hours before it. */
    fun nightOf(at: Instant): String = Format.weekdayName(at.minus(NIGHT_RUNS_PAST_MIDNIGHT), RunWords.eastern)

    /** week-read.ts NIGHT_RUNS_PAST_MIDNIGHT_MS. */
    private val NIGHT_RUNS_PAST_MIDNIGHT: Duration = Duration.ofHours(6)

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
