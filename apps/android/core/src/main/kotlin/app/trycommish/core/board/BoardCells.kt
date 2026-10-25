package app.trycommish.core.board

import app.trycommish.api.models.DesignationStatus
import app.trycommish.api.models.RunBoardRow
import app.trycommish.api.models.RunClub
import app.trycommish.api.models.RunMarketRow
import app.trycommish.api.models.RunPlayerStatus
import app.trycommish.core.Format
import app.trycommish.core.instantOrNull
import app.trycommish.core.shell.SheetPlayer
import app.trycommish.core.shell.initialsOf
import app.trycommish.core.start.RowStatus
import app.trycommish.core.start.RowStatuses
import app.trycommish.design.Words
import java.time.ZoneId

/** A position view of the board, as the run names the positions (derive.ts POSITIONS, in that order).
 * Kickers and defenses are listed in the drafts' order, with no projection of ours. */
enum class BoardPosition(
    val id: String,
) {
    Quarterback("QB"),
    RunningBack("RB"),
    Receiver("WR"),
    TightEnd("TE"),
    Kicker("K"),
    Defense("DST"),
    ;

    val label: String get() = if (this == Defense) Words.Board.defense else id

    /** A kicker's or a defense's view: the drafts' order, no points of ours. */
    val draftOrder: Boolean get() = this == Kicker || this == Defense

    /** What a tier's players are called, one and many (derive.ts POSITION_NAMES, generated). */
    val group: Pair<String, String>
        get() =
            when (this) {
                Quarterback -> Words.TierGroup.QBOne to Words.TierGroup.QBMany
                RunningBack -> Words.TierGroup.RBOne to Words.TierGroup.RBMany
                Receiver -> Words.TierGroup.WROne to Words.TierGroup.WRMany
                TightEnd -> Words.TierGroup.TEOne to Words.TierGroup.TEMany
                Kicker -> Words.TierGroup.KOne to Words.TierGroup.KMany
                Defense -> Words.TierGroup.DSTOne to Words.TierGroup.DSTMany
            }

    companion object {
        fun of(id: String): BoardPosition? = entries.firstOrNull { it.id == id }
    }
}

/** The Gap's tone (gap-picks.ts gapTone): plus when drafters wait, minus when they reach. */
enum class GapTone {
    Gain,
    Loss,
    Even,
    ;

    companion object {
        fun of(gap: Double?): GapTone? =
            when {
                gap == null -> null
                gap > 0 -> Gain
                gap < 0 -> Loss
                else -> Even
            }
    }
}

/** The tint on a row's Over replacement (ui/heat.ts heatFor): the round his value ranks in, rounds 1 to
 * 4, the rose wash below replacement, none after the fourth round. */
sealed interface Heat {
    /** The web's class for the tint: "heat-1", "heat-neg", "none". */
    val id: String

    data class Round(
        val round: Int,
    ) : Heat {
        override val id: String get() = "heat-$round"
    }

    data object Below : Heat {
        override val id: String = "heat-neg"
    }

    data object None : Heat {
        override val id: String = "none"
    }

    companion object {
        /** heat.ts TINTED_ROUNDS. */
        private val TINTED = 1..4

        fun of(
            vor: Double,
            round: Int,
        ): Heat =
            when {
                vor < 0 -> Below
                round in TINTED -> Round(round)
                else -> None
            }
    }
}

/** One player's row as the web's board row draws it at 390 (Row.svelte): his name the biggest thing,
 * his position pill with his number there (or the list he is on), his club and bye under it, his
 * status chip, then the view's figures. */
data class BoardRow(
    val id: String,
    val name: String,
    val initials: String,
    /** His face (the run's headshot, https only), null for a defense, which has none. */
    val headshot: String?,
    /** "WR 4", "RB IR", "DST". */
    val pill: String,
    val club: String,
    /** "Bye 11", "Bye Done" once it is before the week a rest-of-season board ranks from; null when the
     * run names no bye for his club. */
    val bye: String?,
    val status: RowStatus?,
    /** His projected points, the row's one big number; the empty figure for a kicker or a defense. */
    val projected: String,
    /** Over replacement, signed, and its tint. */
    val overReplacement: String,
    val heat: Heat,
    val gap: String,
    val gapTone: GapTone?,
    /** A kicker's or a defense's place in the drafts' order. */
    val draftOrder: String,
    val adp: String,
    /** The player his row opens in the sheet; null where the site has no page for him. */
    val sheetPlayer: SheetPlayer?,
)

/** A run row's cells as the phone prints them. */
internal class BoardCells(
    private val statuses: Map<String, RunPlayerStatus>,
    /** Each club's bye by its abbreviation (server/run.ts clubByes). */
    private val byes: Map<String, Int>,
    /** The week a rest-of-season board ranks from; null on a board of the full season. */
    private val fromWeek: Int?,
    private val zone: ZoneId,
) {
    /** Row.svelte's phone bye with format/bye.ts byeCell: "Bye 11", "Bye Done" for a bye before the week
     * the board ranks from. */
    fun bye(club: String): String? =
        byes[club]?.let { week ->
            val done = fromWeek != null && week < fromWeek
            "${Words.Board.bye} ${if (done) Words.Bye.done else week.toString()}"
        }

    fun ranked(row: RunBoardRow): BoardRow {
        val label = BoardPosition.of(row.position.value)?.label ?: row.position.value
        val status = statuses[row.id]?.let { BoardStatus.view(it, zone) }
        val rank = status?.rank ?: row.positionRank.toString()
        // A player on a season-long list: his rank is the word, so no gap (Row.svelte heldOut).
        val gap = if (status?.onList == true) null else row.gap?.toDouble()
        return BoardRow(
            id = row.id,
            name = row.name,
            initials = initialsOf(row.name),
            headshot = face(row.headshot),
            pill = "$label $rank",
            club = row.team,
            bye = bye(row.team),
            status = status,
            projected = BoardFigures.projected(row.projected.toDouble()),
            overReplacement = BoardFigures.signed(row.vor.toDouble()),
            heat = Heat.of(row.vor.toDouble(), row.vorRound),
            gap = BoardFigures.gap(gap),
            gapTone = GapTone.of(gap),
            draftOrder = row.positionRank.toString(),
            adp = row.adp?.let { Format.fixed(it.toDouble()) } ?: Words.Box.none,
            sheetPlayer = SheetPlayer(row.id, row.slug, row.name, label, rank, row.team),
        )
    }

    /** A kicker or a defense: his place is his Draft order column, so his pill is his position alone
     * (Row.svelte pillRank) or his list's word; the site has no page of his to open. */
    fun market(row: RunMarketRow): BoardRow {
        val label = BoardPosition.of(row.position.value)?.label ?: row.position.value
        val status = statuses[row.id]?.let { BoardStatus.view(it, zone) }
        return BoardRow(
            id = row.id,
            name = row.name,
            initials = initialsOf(row.name),
            headshot = row.headshot?.let(::face),
            pill = listOfNotNull(label, status?.rank).joinToString(" "),
            club = row.team,
            bye = bye(row.team),
            status = status,
            projected = Words.Box.none,
            overReplacement = Words.Box.none,
            heat = Heat.None,
            gap = Words.Box.none,
            gapTone = null,
            draftOrder = row.positionRank.toString(),
            adp = Format.fixed(row.adp.toDouble()),
            sheetPlayer = null,
        )
    }

    companion object {
        fun byes(clubs: List<RunClub>): Map<String, Int> =
            clubs.mapNotNull { club -> club.bye?.let { club.abbr to it } }.distinctBy { it.first }.toMap()

        /** His face where the run gives an https address. */
        fun face(address: String): String? = address.takeIf { it.startsWith("https://") }
    }
}

/** His status as the board row's chip says it (status-view.ts statusView): a season-long list's word in
 * place of his rank and its start, a week's designation, or due back this week. */
internal object BoardStatus {
    fun view(
        status: RunPlayerStatus,
        zone: ZoneId,
    ): RowStatus? {
        val known = status.status.takeUnless { it == DesignationStatus.unknown_default_open_api } ?: return null
        if (status.seasonLong) {
            return RowStatus(
                rank = RowStatuses.rankWord(known),
                mark = RowStatuses.seasonLongMark(known, instantOrNull(status.since), status.returning, zone),
                sits = true,
                question = false,
            )
        }
        val mark = status.returning?.let { "Due back ${RowStatuses.calendarDay(it, weekday = true)}" } ?: RowStatuses.word(known)
        return RowStatus(rank = null, mark = mark, sits = RowStatuses.sits(known), question = known == DesignationStatus.questionable)
    }
}
