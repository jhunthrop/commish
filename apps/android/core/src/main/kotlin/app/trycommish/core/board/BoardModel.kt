package app.trycommish.core.board

import app.trycommish.api.models.RunBoardAnswer
import app.trycommish.api.models.RunFormat
import app.trycommish.api.models.RunPlayerStatus
import app.trycommish.core.Format
import app.trycommish.core.instantOrNull
import app.trycommish.design.Words
import java.time.Instant
import java.time.ZoneId

/** A chip: its words, what it chooses, and whether it is the one pressed. */
data class BoardChip<Value>(
    val label: String,
    val value: Value,
    val pressed: Boolean,
)

/** A tier's band over its rows as the phone draws it (TierStrip.svelte): its number on the tier's shade,
 * its name and count, and its drop to the next tier, or the last tier's words. */
data class TierBand(
    val tier: Int,
    /** "Tier 3". */
    val name: String,
    /** "8 WRs". */
    val count: String,
    /** The drop's figure, "16.9", null where none is said. */
    val drop: String?,
    /** "PPR pts to tier 4", or "Last tier" with no drop. */
    val dropWords: String,
) {
    /** The band's cliff as one line, "16.9 PPR pts to tier 4". */
    val cliff: String get() = drop?.let { "$it $dropWords" } ?: dropWords
}

/** A run of rows under a tier's band or a head: a position's tiers, its season-long list, a view's rows. */
data class BoardSection(
    val id: String,
    val head: String?,
    val band: TierBand?,
    val rows: List<BoardRow>,
)

/** The figures a view carries, each named once over the rows. */
sealed interface BoardColumns {
    val heads: List<String>

    /** Projected, Over repl and, where the board compares drafters with our rank, the Gap. */
    data class Ranked(
        val gap: Boolean,
    ) : BoardColumns {
        override val heads: List<String>
            get() = listOf(Words.Figure.projected, Words.Board.overReplShort) + listOfNotNull(Words.Board.gap.takeIf { gap })
    }

    /** A kicker's or a defense's place in the drafts' order and his ADP. */
    data object DraftOrder : BoardColumns {
        override val heads: List<String> = listOf(Words.Board.draftOrder, Words.Board.adp)
    }
}

/**
 * The Board screen as the web's board says it at 390 (the iOS BoardModel's twin), from the run: the
 * heading, the run's stamp and, in season, the weeks it ranks; the format and position chips; the view's
 * rows in the run's order, a position's in its tiers with their cliffs; and the basis once.
 */
data class BoardModel(
    val words: BoardWords,
    /** "Updated Oct 21": the run every number comes from. */
    val stamp: String,
    /** The weeks a rest-of-season board ranks, under the heading; null on a board of the full season. */
    val restLine: String?,
    val formats: List<BoardChip<String>>,
    val positions: List<BoardChip<BoardPosition?>>,
    val columns: BoardColumns,
    val sections: List<BoardSection>,
    /** What the numbers are as the web's board says them, then the capture the statuses come from. */
    val basis: List<String>,
) {
    val rows: List<BoardRow> get() = sections.flatMap { it.rows }

    companion object {
        /** `inSeason` is the bar's season; `following` whether the member follows a league. */
        fun of(
            read: RunBoardRead,
            position: BoardPosition?,
            inSeason: Boolean,
            following: Boolean,
            now: Instant,
            zone: ZoneId,
        ): BoardModel {
            val manifest = read.manifest
            val format = read.format
            val board = read.board
            val statuses = read.designations?.players.orEmpty()
            val cells = BoardCells(statuses, BoardCells.byes(read.clubs), format.rosFromWeek, zone)
            val view = viewRows(board, position, statuses, cells, format.unit)
            val draftOrder = position?.draftOrder == true
            val columns = if (draftOrder) BoardColumns.DraftOrder else BoardColumns.Ranked(format.rosFromWeek == null && view.carriesGap)
            val said =
                if (draftOrder) {
                    listOf(BoardBasis.draftOrder(format, read.sources))
                } else {
                    BoardBasis.ranked(format, manifest.season, position, read.sources, columns == BoardColumns.Ranked(true))
                }
            // A kicker's or a defense's view says the capture only when one of its rows is listed.
            val listed = !draftOrder || view.sections.any { section -> section.rows.any { it.status != null } }
            val capture =
                read.designations?.takeIf { listed }?.let {
                    BoardWords.capture(
                        asOf = instantOrNull(it.readAt) ?: now,
                        checkedAt = instantOrNull(it.checkedAt),
                        now = now,
                        zone = zone,
                    )
                }
            val present = (board.rows.map { it.position.value } + board.market.map { it.position.value }).toSet()
            return BoardModel(
                words =
                    BoardWords.of(
                        inSeason,
                        BoardCover(manifest.season, format.label, position?.label, format.rosFromWeek != null),
                        following,
                    ),
                stamp = RunWords.stamp(manifest),
                restLine = RunWords.restCaption(format, manifest.season),
                formats = manifest.formats.map { BoardChip(it.label, it.id, it.id == format.id) },
                positions =
                    listOf(BoardChip<BoardPosition?>(Words.Board.all, null, position == null)) +
                        BoardPosition.entries.filter { it.id in present }.map { BoardChip(it.label, it, it == position) },
                columns = columns,
                sections = view.sections,
                basis = said + listOfNotNull(capture),
            )
        }

        /** The format chips with the chosen one pressed, alone over a format whose board could not be read,
         * so the member can choose another; none before the run's manifest is read. */
        fun formatChips(
            formats: List<RunFormat>,
            chosen: String?,
        ): List<BoardChip<String>> =
            formats.mapIndexed { index, format ->
                BoardChip(format.label, format.id, format.id == chosen || (chosen == null && index == 0))
            }
    }
}

/** A view's sections and whether its ranked rows carry a Gap (format/gap.ts carriesGap). */
private class ViewRows(
    val sections: List<BoardSection>,
    val carriesGap: Boolean,
)

/** All in the run's order, a ranked position in its tiers then its season-long list, a kicker's or a
 * defense's list in the drafts' order. */
private fun viewRows(
    board: RunBoardAnswer,
    position: BoardPosition?,
    statuses: Map<String, RunPlayerStatus>,
    cells: BoardCells,
    unit: String,
): ViewRows {
    val ranked = board.rows.map { it.placed() }
    if (position == null) {
        val rows = BoardOrder.withStatuses(ranked, statuses).map { it.row }
        return ViewRows(listOf(BoardSection("all", null, null, rows.map(cells::ranked))), rows.any { it.gap != null })
    }
    if (position.draftOrder) {
        val rows = BoardOrder.withStatuses(BoardOrder.at(board.market.map { it.placed() }, position), statuses).map { it.row }
        return ViewRows(listOf(BoardSection(position.id, null, null, rows.map(cells::market))), carriesGap = false)
    }
    val rows = BoardOrder.withStatuses(BoardOrder.at(ranked, position), statuses).map { it.row }
    val held = rows.filter { BoardOrder.heldOut(it.id, statuses) }
    val tiers =
        BoardOrder.tiers(ranked, position, statuses).map { group ->
            BoardSection("${position.id}-${group.tier}", null, band(group, position, unit), group.rows.map(cells::ranked))
        }
    val heldSection = BoardSection("${position.id}-held", Words.Board.heldHead, null, held.map(cells::ranked))
    return ViewRows(tiers + listOfNotNull(heldSection.takeIf { held.isNotEmpty() }), rows.any { it.gap != null })
}

/** TierStrip.svelte's words for a tier. */
private fun band(
    group: TierGroup,
    position: BoardPosition,
    unit: String,
): TierBand {
    val (one, many) = position.group
    return TierBand(
        tier = group.tier,
        name = "${Words.Tier.tier} ${group.tier}",
        count = Format.plural(group.rows.size, one, many),
        drop = group.drop?.let { Format.fixed(it) },
        dropWords = if (group.drop == null) Words.Tier.lastTier else "$unit ${Words.Tier.toTier} ${group.tier + 1}",
    )
}
