package app.trycommish.core.start

import app.trycommish.api.models.DesignationStatus
import app.trycommish.api.models.InjuryDesignation
import app.trycommish.core.Format
import app.trycommish.core.instantOrNull
import app.trycommish.design.Words
import java.time.Instant
import java.time.ZoneId
import java.time.ZoneOffset

/** A player's status as a row's chip draws it (web designation.ts, box.ts statusOf and rowStatus,
 * next-week.ts carriedMark), ported: the week's designation, or a season-long list's word in place of
 * his rank. */
data class RowStatus(
    /** The list's short word where his rank would be ("IR"), null for a week's designation. */
    val rank: String?,
    /** The chip's words: "Questionable", "Due back Sun Oct 18", "IR since Sep 28". */
    val mark: String,
    /** It keeps him out (drawn as a loss). */
    val sits: Boolean,
    /** Questionable: a question, not a reason to sit him. */
    val question: Boolean,
) {
    /** On a season-long list: no week Proj, no Opp rank, no change in either (box.ts onList). */
    val onList: Boolean get() = rank != null
}

internal object RowStatuses {
    private val seasonLongStatuses =
        setOf(DesignationStatus.injured_reserve, DesignationStatus.pup, DesignationStatus.nfi, DesignationStatus.suspended)

    /** designation.ts DESIGNATION_WORDS, generated. */
    fun word(status: DesignationStatus): String =
        when (status) {
            DesignationStatus.questionable -> Words.Designation.questionable
            DesignationStatus.doubtful -> Words.Designation.doubtful
            DesignationStatus.out -> Words.Designation.out
            DesignationStatus.injured_reserve -> Words.Designation.injured_reserve
            DesignationStatus.suspended -> Words.Designation.suspended
            DesignationStatus.pup -> Words.Designation.pup
            DesignationStatus.nfi -> Words.Designation.nfi
            DesignationStatus.unknown_default_open_api -> Words.Box.none
        }

    /** designation.ts RANK_WORDS, generated: "IR", "PUP", a status in a rank's few characters. */
    fun rankWord(status: DesignationStatus): String =
        when (status) {
            DesignationStatus.questionable -> Words.DesignationRank.questionable
            DesignationStatus.doubtful -> Words.DesignationRank.doubtful
            DesignationStatus.out -> Words.DesignationRank.out
            DesignationStatus.injured_reserve -> Words.DesignationRank.injured_reserve
            DesignationStatus.suspended -> Words.DesignationRank.suspended
            DesignationStatus.pup -> Words.DesignationRank.pup
            DesignationStatus.nfi -> Words.DesignationRank.nfi
            DesignationStatus.unknown_default_open_api -> Words.Box.none
        }

    /** The short word for his status in a rank's place, a week's designation too ("O", "IR"): the
     * designation first, else the platform's injured reserve (statusOf's order); null with neither. */
    fun rankWordOf(
        designation: InjuryDesignation?,
        hostIR: Boolean,
    ): String? = (known(designation) ?: DesignationStatus.injured_reserve.takeIf { hostIR })?.let(::rankWord)

    private fun known(designation: InjuryDesignation?): DesignationStatus? =
        designation?.status?.takeUnless { it == DesignationStatus.unknown_default_open_api }

    private fun seasonLong(
        status: DesignationStatus,
        flagged: Boolean,
    ): Boolean = flagged || status in seasonLongStatuses

    fun sits(status: DesignationStatus): Boolean = status != DesignationStatus.questionable && status != DesignationStatus.doubtful

    /** box.ts statusOf: the week's designation first, else the platform's injured reserve; null with
     * neither, or with a status this build does not know. */
    fun of(
        designation: InjuryDesignation?,
        hostIR: Boolean,
        zone: ZoneId,
    ): RowStatus? {
        val status = known(designation) ?: (if (hostIR) DesignationStatus.injured_reserve else null) ?: return null
        val listed = seasonLong(status, designation?.seasonLong == true)
        val returning = designation?.returning
        val mark =
            when {
                listed -> seasonLongMark(status, instantOrNull(designation?.since), returning, zone)
                returning != null -> "Due back ${calendarDay(returning, weekday = true)}"
                else -> carriedMark(designation, zone) ?: word(status)
            }
        return RowStatus(if (listed) rankWord(status) else null, mark, sits(status), status == DesignationStatus.questionable)
    }

    /** box.ts rowStatus: Questionable and Doubtful are words about a game still to come, so once his game
     * has kicked off they drop and the platform's injured reserve, if any, stays. */
    fun row(
        designation: InjuryDesignation?,
        hostIR: Boolean,
        toCome: Boolean,
        zone: ZoneId,
    ): RowStatus? {
        val status = of(designation, hostIR, zone)
        if (status == null || status.sits || toCome) return status
        return of(null, hostIR && !dueBack(designation), zone)
    }

    /** He is due back this week on a week's designation (box.ts dueBack). */
    fun dueBack(designation: InjuryDesignation?): Boolean {
        val status = known(designation) ?: return false
        return designation?.returning != null && !seasonLong(status, designation.seasonLong == true)
    }

    /** designation.ts seasonLongMark: "IR since Sep 22", "IR, back Nov 8", or "IR". */
    fun seasonLongMark(
        status: DesignationStatus,
        since: Instant?,
        returning: String?,
        zone: ZoneId,
    ): String {
        val word = rankWord(status)
        if (returning != null) return "$word, back ${calendarDay(returning, weekday = false)}"
        return since?.let { "$word since ${Format.shortDay(it, zone)}" } ?: word
    }

    /** next-week.ts carriedMark: "Out, listed Oct 12", "Out, still listed", null unless carried over. */
    private fun carriedMark(
        designation: InjuryDesignation?,
        zone: ZoneId,
    ): String? {
        val status = known(designation) ?: return null
        if (designation?.carriedOver != true) return null
        val said = word(status)
        return instantOrNull(designation.listed)?.let { "$said, listed ${Format.shortDay(it, zone)}" } ?: "$said, still listed"
    }

    /** designation.ts calendarDay: an ISO day ("2026-10-18") as "Oct 18", with its weekday "Sun Oct 18",
     * the same day on every clock. */
    fun calendarDay(
        day: String,
        weekday: Boolean,
    ): String {
        val noon = instantOrNull("${day}T12:00:00Z") ?: return day
        val date = Format.shortDay(noon, ZoneOffset.UTC)
        return if (weekday) "${Format.weekdayTime(noon, ZoneOffset.UTC).take(WEEKDAY_LETTERS)} $date" else date
    }

    private const val WEEKDAY_LETTERS = 3
}
