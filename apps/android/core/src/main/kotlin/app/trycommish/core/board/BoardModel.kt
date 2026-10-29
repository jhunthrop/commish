package app.trycommish.core.board

import app.trycommish.api.models.OrderRow
import app.trycommish.api.models.RunBoardAnswer
import app.trycommish.api.models.RunBoardRow
import app.trycommish.api.models.RunFormat
import app.trycommish.api.models.RunPlayerStatus
import app.trycommish.core.Format
import app.trycommish.core.instantOrNull
import app.trycommish.core.liveorder.LiveOrder
import app.trycommish.core.liveorder.LiveOrderWords
import app.trycommish.core.liveorder.LivePlace
import app.trycommish.core.liveorder.OrderAtClock
import app.trycommish.core.liveorder.PlacedFigures
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
 * rows in the run's order, a position's in its tiers with their cliffs; and the basis once. In season,
 * once the order the in-season pages read (GET /order) answers, the view is the order's: the run's rows
 * it places, in its order with its figures (as far as its read reaches, the count said once when the
 * answer is cut), a position's with no tiers (they are the run's), the players it does not place after
 * them (on a season-long list, or returned with no figure) with their status's word, and the order's lead under the heading and in the board sentence's place; until then the
 * run's rows stand and the basis says the run's day and time (Lane 226, LiveOrder).
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
    /** Whether the rows carry the order's figures at its clock. */
    val atClock: Boolean = false,
) {
    val rows: List<BoardRow> get() = sections.flatMap { it.rows }

    companion object {
        /** `inSeason` is the bar's season; `following` whether the member follows a league; `order` the
         * order as read at the screen's clock, null while unread or when the read failed. */
        @Suppress("LongParameterList")
        fun of(
            read: RunBoardRead,
            position: BoardPosition?,
            inSeason: Boolean,
            following: Boolean,
            now: Instant,
            zone: ZoneId,
            order: OrderAtClock? = null,
        ): BoardModel {
            val manifest = read.manifest
            val format = read.format
            val board = read.board
            val statuses = read.designations?.players.orEmpty()
            val cells = BoardCells(statuses, BoardCells.byes(read.clubs), format.rosFromWeek, zone)
            val ranksRest = inSeason && format.rosFromWeek != null
            val clock =
                order
                    ?.takeIf { ranksRest && LiveOrder.inScoring(it.answer, format) }
                    ?.let { ClockPlaces(it.places, format.teams, it.rows, LiveOrder.cut(it.answer), zone) }
            val view = viewRows(board, position, statuses, cells, format.unit, clock)
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
            val runCapture = read.designations?.let { CaptureStamp(instantOrNull(it.readAt) ?: now, instantOrNull(it.checkedAt)) }
            // At the order's clock the statuses are the order's: the status column is as of the newer capture.
            val stamp = CaptureStamp.newer(runCapture, order?.takeIf { view.atClock }?.capture)
            val capture = stamp?.takeIf { listed }?.let { BoardWords.capture(it, now, zone) }
            val run = said + listOfNotNull(capture)
            val lead = order?.takeIf { view.atClock }?.lead(format.teams, zone)
            val basis =
                if (draftOrder || !ranksRest) {
                    run
                } else {
                    LiveOrder.basis(run, BoardBasis.ourBoard(format, manifest.season), lead, LiveOrderWords.runStamp(format, zone)) +
                        listOfNotNull(
                            view.reach?.let { (shown, total) -> LiveOrderWords.reach(shown, total) },
                            LiveOrderWords.fromRun(view.fromRun),
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
                // The head follows the basis's clock: the order's lead once its rows stand.
                restLine = lead ?: RunWords.restCaption(format, manifest.season),
                formats = manifest.formats.map { BoardChip(it.label, it.id, it.id == format.id) },
                positions =
                    listOf(BoardChip<BoardPosition?>(Words.Board.all, null, position == null)) +
                        BoardPosition.entries.filter { it.id in present }.map { BoardChip(it.label, it, it == position) },
                columns = columns,
                sections = view.sections,
                basis = basis,
                atClock = view.atClock,
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

/** A view's sections, whether its ranked rows carry a Gap (format/gap.ts carriesGap), whether they are
 * the order's, and at the order's clock the view's rows drawn and its rows on the run, when fewer are
 * drawn. */
private class ViewRows(
    val sections: List<BoardSection>,
    val carriesGap: Boolean,
    val atClock: Boolean = false,
    val reach: Pair<Int, Int>? = null,
    /** The view's run players an uncut order omits, drawn from the run (Lane 280, B257). */
    val fromRun: Int = 0,
)

/** The order's places for a board of `teams`, every row it returned by board id, placed or not, and
 * whether its answer is cut (it holds more players than it returned). */
private class ClockPlaces(
    val places: Map<String, LivePlace>,
    val teams: Int,
    val rows: Map<String, OrderRow>,
    val cut: Boolean,
    val zone: ZoneId,
) {
    /** The status the order's own row carries for a board id, null with none or no row. */
    fun said(id: String): HeldStatus? = rows[id]?.let { HeldStatus.of(it.line, zone) }
}

/** A ranked view at the order's clock: the rows the order places, in its order with its figures, a
 * position's as one run with no tiers, then the view's players it does not place, in the run's order with
 * no figure: those on a season-long list and those the order returns with no figure (a player put on a
 * list after the nightly, Lane 243, B251), each with the word of the order's own row's status, else the
 * run's, else "--", as the Rankings draw him. On a cut answer the rows its read does not reach are not
 * drawn, so no row of the run's clock stands among them, and the count is said; on an uncut one a run
 * player the order omits is drawn from the run with the run's status and counted once (Lane 280, B257).
 * Null where the read places none of the view's rows. */
private fun atClock(
    drawn: List<Placed<RunBoardRow>>,
    position: BoardPosition?,
    statuses: Map<String, RunPlayerStatus>,
    cells: BoardCells,
    clock: ClockPlaces,
): ViewRows? {
    val reached = drawn.map { it.row }.filter { it.id in clock.places }
    val placed = LiveOrder.placed(reached, { it.id }, clock.places)?.takeIf { it.isNotEmpty() } ?: return null
    val rows = placed.map { cells.placed(it.row, PlacedFigures.of(it.row).at(it.place, clock.teams), clock.said(it.row.id)) }
    val ordered = BoardOrder.withStatuses(drawn, statuses).map { it.row }
    val omitted = LiveOrder.omittedFromRun(ordered.map { it.id }, clock.rows.keys, clock.cut).toSet()
    val listed =
        ordered
            .filter { it.id !in clock.places && (BoardOrder.heldOut(it.id, statuses) || it.id in clock.rows || it.id in omitted) }
            .map { row -> cells.listed(row, clock.said(row.id) ?: cells.held(row.id)) }
    val shown = rows.size + listed.size
    val reach = (shown to drawn.size).takeIf { clock.cut && shown < drawn.size }
    return ViewRows(clockSections(rows, listed, position), carriesGap = false, atClock = true, reach = reach, fromRun = omitted.size)
}

/** A view's sections at the order's clock: All as one run, the order's rows then the rows it does not
 * place; a position's order rows, then under the list's head only the rows on a season-long list, then the
 * other unplaced rows with no head (Lane 243 fix round 1, M1: a row on no list never sits under it). */
private fun clockSections(
    rows: List<BoardRow>,
    listed: List<BoardRow>,
    position: BoardPosition?,
): List<BoardSection> {
    if (position == null) return listOf(BoardSection("all", null, null, rows + listed))
    val (held, others) = listed.partition { it.status?.onList == true }
    return listOfNotNull(
        BoardSection(position.id, null, null, rows),
        BoardSection("${position.id}-held", Words.Board.heldHead, null, held).takeIf { held.isNotEmpty() },
        BoardSection("${position.id}-unplaced", null, null, others).takeIf { others.isNotEmpty() },
    )
}

/** All in the run's order, a ranked position in its tiers then its season-long list, a kicker's or a
 * defense's list in the drafts' order. */
private fun viewRows(
    board: RunBoardAnswer,
    position: BoardPosition?,
    statuses: Map<String, RunPlayerStatus>,
    cells: BoardCells,
    unit: String,
    clock: ClockPlaces?,
): ViewRows {
    val ranked = board.rows.map { it.placed() }
    if (clock != null && position?.draftOrder != true) {
        atClock(position?.let { BoardOrder.at(ranked, it) } ?: ranked, position, statuses, cells, clock)?.let { return it }
    }
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
