package app.trycommish.core.record

import app.trycommish.api.models.RunDraftLine
import app.trycommish.api.models.RunRecord
import app.trycommish.api.models.RunRecordLine
import app.trycommish.api.models.RunRecordPosition
import app.trycommish.api.models.RunRecordWeek
import app.trycommish.api.models.RunRecordWeekStatus
import app.trycommish.core.Format
import app.trycommish.design.Words

/** WeeklySection.svelte and DraftSection.svelte over the record's functions, ported as iOS's
 * RecordSections. */
internal object RecordSections {
    /** record.ts recordLead: the run's own record's lead, naming only the orders drawn. */
    fun lead(
        book: RecordBook,
        scoring: String,
    ): String {
        val beside = if (RecordPairs.drawn(book, RecordSource.Published)) "ADP and the week's published projection" else "ADP"
        return "How the order we set before each week's kickoff called its games, beside $beside, graded in $scoring"
    }

    private fun figureHead(
        book: RecordBook,
        figure: RecordFigure,
    ): String =
        when (figure) {
            RecordFigure.Agreement -> book.statistic.agreement
            RecordFigure.PlacesOff -> book.statistic.placesOff
            RecordFigure.Starters -> book.statistic.starters
        }

    private fun position(line: RunRecordLine): String = line.position.value

    /** The weekly record's section, or the run's own record's (fromWeek null). */
    fun weekly(
        book: RecordBook,
        fromWeek: Int?,
        states: WeekStates,
        next: NextGrade?,
    ): RecordSectionModel {
        val weekly = fromWeek != null
        val sources = if (weekly) RecordPairs.weeklySources(book) else RecordPairs.sources(book)
        val positions = book.toDate.map(::position)
        val lines =
            if (weekly) {
                RecordLines.weeklyLines(book.weeks, states.unplayed, states.underway)
            } else {
                RecordLines.weekLines(book.weeks, states.unplayed, states.underway)
            }
        val all = book.toDate.firstOrNull { it.position == RunRecordPosition.All }
        return RecordSectionModel(
            head = if (weekly) Words.Records.weekly to Words.Records.weeklyWhat else null,
            bug = bug(book, weekly, sources, states, next),
            positions = if (positions.size > 1) positions else emptyList(),
            figures = RecordFigure.entries.map { RecordWords.capitalized(figureHead(book, it)) },
            sourceHeads = sources.map(RecordWords::head),
            before = fromWeek?.let(RecordLines::before),
            rows = lines.map { row(it, positions, sources, weekly) },
            toDate =
                all?.let {
                    RecordToDate(
                        Words.RecordBox.toDate,
                        "${it.ours.graded} distinct",
                        cellsByPosition(book.toDate, positions, sources, weekly),
                    )
                },
            basis = basis(book, weekly),
        )
    }

    /** The bug: the tiles once the season to date carries All, else the pending week (the weekly record),
     * else the headline. */
    private fun bug(
        book: RecordBook,
        weekly: Boolean,
        sources: List<RecordSource>,
        states: WeekStates,
        next: NextGrade?,
    ): RecordBug {
        val gaps = RecordLines.gaps(book, states.unplayed)
        val all = book.toDate.firstOrNull { it.position == RunRecordPosition.All }
        if (all == null) {
            val pending = if (weekly) RecordLines.pending(book, next) else null
            if (pending != null) {
                val pendingGaps = RecordLines.gaps(book, states.unplayed, next?.week)
                return RecordBug.Pending(pending.first, pending.second, pendingGaps)
            }
            val headline = RecordLines.headline(book)
            return RecordBug.Headline(headline.first, headline.second, gaps)
        }
        val tiles =
            RecordFigure.entries.map { figure ->
                if (weekly) weeklyTile(book, all, figure, sources) else ownTile(book, all, figure, sources)
            }
        val head =
            if (weekly) {
                RecordWords.spanLead(book.weeks.filter { it.status == RunRecordWeekStatus.graded }.map { it.week })
            } else {
                RecordLines.gradedOrders(book)
            }
        return RecordBug.Tiles(RecordLines.standing(book), head, tiles, gaps, book.honest)
    }

    private fun weeklyTile(
        book: RecordBook,
        all: RunRecordLine,
        figure: RecordFigure,
        sources: List<RecordSource>,
    ): RecordTile = RecordTile(figure, figureHead(book, figure), RecordPairs.weekly(all, figure, sources), null, emptyList())

    private fun ownTile(
        book: RecordBook,
        all: RunRecordLine,
        figure: RecordFigure,
        sources: List<RecordSource>,
    ): RecordTile =
        RecordTile(
            figure = figure,
            label = figureHead(book, figure),
            pairs = null,
            ours = RecordWords.figure(all.ours, figure),
            beside =
                sources.filter { it != RecordSource.Ours }.map { source ->
                    val (value, ours) = RecordWords.beside(all, source, figure)
                    RecordBeside(RecordWords.head(source), value, ours?.lowercase())
                },
        )

    private fun row(
        line: WeekLine,
        positions: List<String>,
        sources: List<RecordSource>,
        weekly: Boolean,
    ): RecordRow {
        val week = line.week
        val graded = week?.status == RunRecordWeekStatus.graded
        val order = week?.let { if (weekly) RecordLines.weeklyOrder(it) else RecordLines.weekOrder(it) }
        return RecordRow(
            lead = line.lead,
            text = RecordWords.capitalized(line.text),
            order = order,
            graded = graded,
            caption = if (graded) caption(week, order, line.text, weekly) else null,
            players =
                if (graded) {
                    (
                        week
                            ?.lines
                            ?.firstOrNull { it.position == RunRecordPosition.All }
                            ?.ours
                            ?.graded ?: 0
                    ).toString()
                } else {
                    null
                },
            cells = if (graded) cellsByPosition(week?.lines.orEmpty(), positions, sources, weekly) else null,
            note = if (weekly && graded) week?.espnNote else null,
        )
    }

    /** A graded week's caption: the order with when it was graded on the weekly record (its order words
     * carry the set date), the order with the run's own words on the record before Lane 114. */
    private fun caption(
        week: RunRecordWeek?,
        order: String?,
        text: String,
        weekly: Boolean,
    ): String {
        if (order == null) return RecordWords.capitalized(text)
        val gradedAt = week?.gradedAt
        if (!weekly || gradedAt == null) return "$order, $text"
        return "$order, graded ${RecordWords.weekdayDay(gradedAt)}"
    }

    private fun cellsByPosition(
        lines: List<RunRecordLine>,
        positions: List<String>,
        sources: List<RecordSource>,
        weekly: Boolean,
    ): RecordCells = positions.associateWith { name -> cells(lines.firstOrNull { position(it) == name }, sources, weekly) }

    /** A line's cells for every figure and order drawn. */
    private fun cells(
        line: RunRecordLine?,
        sources: List<RecordSource>,
        weekly: Boolean,
    ): Map<RecordFigure, RecordFigureCells> =
        RecordFigure.entries.associateWith { figure ->
            val cells =
                sources.map { source ->
                    if (source == RecordSource.Ours) {
                        RecordCell(RecordWords.head(source), RecordWords.figure(line?.ours, figure), null)
                    } else {
                        val (value, same) = RecordWords.beside(line, source, figure)
                        RecordCell(RecordWords.head(source), value, same)
                    }
                }
            RecordFigureCells(weekly && !RecordPairs.oursLeadsAll(RecordPairs.weekly(line, figure, sources)), cells)
        }

    /** The phone's basis: records.ts weeklyBasis's parts both widths say (the scale, places off and the
     * starters it counts), or the run's own record's every sentence (record.ts recordBasis). */
    private fun basis(
        book: RecordBook,
        weekly: Boolean,
    ): String {
        val said =
            if (weekly) {
                listOf(book.scale, Words.Record.placesOff, book.startersBasis)
            } else {
                listOf(book.method, book.scale, Words.Record.placesOff, book.startersBasis)
            }
        return said.filterNotNull().filter { it.isNotEmpty() }.joinToString(" ")
    }

    /** The draft record's section, or its line before a run writes it. */
    fun draft(run: RunRecord): DraftSectionModel {
        val heads =
            mapOf(
                RecordFigure.Agreement to run.statistic.agreement,
                RecordFigure.PlacesOff to run.statistic.placesOff,
                RecordFigure.Starters to Words.Records.named,
            )
        val draft =
            run.draft ?: return DraftSectionModel(
                Words.Records.draft,
                Words.Records.draftWhat,
                Words.Records.waiting,
                null,
                null,
                emptyList(),
                null,
                emptyList(),
                emptyList(),
                null,
                "",
            )
        val all = draft.lines.firstOrNull { it.position == RunRecordPosition.All }
        val tops =
            draft.lines
                .filter { it.position != RunRecordPosition.All && it.ours.startersOf > 0 }
                .map { "${it.ours.startersOf} ${it.position.value}" }
        val keys =
            mapOf(RecordFigure.PlacesOff to Words.Records.lowerBetter) +
                if (tops.isEmpty()) emptyMap() else mapOf(RecordFigure.Starters to "of the top ${tops.joinToString(", ")}")
        return DraftSectionModel(
            title = Words.Records.draft,
            what = Words.Records.draftWhat,
            waiting = null,
            span = all?.let { draft.throughWeek?.let { week -> "Season points through week $week" } ?: "No week counted yet" },
            players = all?.let { Format.plural(it.ours.graded, "player", "players") },
            tiles =
                all
                    ?.let { line ->
                        RecordFigure.entries.map { figure ->
                            DraftTile(
                                figure,
                                heads.getValue(figure),
                                keys[figure],
                                FigurePair.of(line.ours, line.adp, figure, Words.RecordBox.adp),
                            )
                        }
                    }.orEmpty(),
            honest = if (all == null) null else draft.honest,
            figures = RecordFigure.entries.map { RecordWords.capitalized(heads.getValue(it)) },
            rows = draft.lines.filter { it.position != RunRecordPosition.All }.map(::draftRow),
            all = all?.let(::draftRow),
            basis = listOfNotNull(Words.Records.draftPositions, draft.namedBasis).filter { it.isNotEmpty() }.joinToString(" "),
        )
    }

    private fun draftRow(line: RunDraftLine): DraftRow =
        DraftRow(
            position = line.position.value,
            players = line.ours.graded,
            cells =
                RecordFigure.entries.associateWith { figure ->
                    val pair = FigurePair.of(line.ours, line.adp, figure, Words.RecordBox.adp)
                    DraftCell(pair.accented, pair.ours, pair.theirs)
                },
        )
}
