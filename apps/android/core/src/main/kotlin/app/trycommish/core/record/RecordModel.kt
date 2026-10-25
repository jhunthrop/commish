package app.trycommish.core.record

import app.trycommish.api.models.RunRecord
import app.trycommish.api.models.RunSchedule
import app.trycommish.core.AppWords
import app.trycommish.design.Words
import java.time.Instant

/** One order's figure in a record's cell, with ours over the same weeks beside a yardstick's. */
data class RecordCell(
    /** Ours, ADP, ESPN, Published. */
    val head: String,
    val value: String,
    /** "Ours 0.42": ours pooled again over the weeks that graded this yardstick; null for ours and ADP. */
    val same: String?,
)

/** A line's cells for one figure, every order drawn, and whether ours trails (the weekly record accents
 * ours only where it leads every yardstick). */
data class RecordFigureCells(
    val trails: Boolean,
    val cells: List<RecordCell>,
)

/** A line's cells by position ("All", "QB"), then by figure. */
typealias RecordCells = Map<String, Map<RecordFigure, RecordFigureCells>>

/** A yardstick's figure beside ours on the run's own record: "ADP 0.31 ours 0.42". */
data class RecordBeside(
    val head: String,
    val value: String,
    /** "ours 0.42", lower case after the yardstick's figure. */
    val ours: String?,
)

/** One figure of the bug: its head and ours beside each yardstick, as pairs on the weekly record or as
 * the run's own record says them. */
data class RecordTile(
    val figure: RecordFigure,
    val label: String,
    /** The weekly record's pairs, each naming its leader; null on the run's own record. */
    val pairs: List<FigurePair>?,
    /** The run's own record: ours, then each yardstick's figure; null on the weekly record. */
    val ours: String?,
    val beside: List<RecordBeside>,
)

/** The bug over the weeks (WeeklySection.svelte): the tiles once a week is graded, the week and when it
 * grades before (the weekly record), or the headline's one figure (the run's own before a grade). */
sealed interface RecordBug {
    val gaps: String

    data class Tiles(
        val standing: String?,
        val head: String,
        val tiles: List<RecordTile>,
        override val gaps: String,
        val honest: String?,
    ) : RecordBug

    data class Pending(
        val title: String,
        val whenSaid: String,
        override val gaps: String,
    ) : RecordBug

    data class Headline(
        val value: String,
        val caption: String,
        override val gaps: String,
    ) : RecordBug
}

/** One line of the week list with its status words and, graded, its cells by position and figure. */
data class RecordRow(
    val lead: String,
    /** The status words, capitalized: "Set Thu Oct 22, 1:00 pm Central, graded Wed Oct 28". */
    val text: String,
    /** The order the week graded: "Our weekly rankings, set Oct 22", "Our preseason order". */
    val order: String?,
    val graded: Boolean,
    /** A graded week's line under its lead on a phone, its order and when it was graded with the set date
     * said once: "Our weekly rankings, set Oct 22, graded Wed Oct 28"; null off a graded week. */
    val caption: String?,
    /** The players graded at All, null off a graded week. */
    val players: String?,
    /** By position, then figure; null off a graded week. */
    val cells: RecordCells?,
    /** The week's ESPN sentence as the run wrote it, under its row once graded. */
    val note: String?,
)

/** The season to date's row. */
data class RecordToDate(
    val lead: String,
    val players: String,
    val cells: RecordCells,
)

/** The weekly record (or the run's own before Lane 114) as WeeklySection.svelte draws it at 390. */
data class RecordSectionModel(
    /** The record's name and what it grades, null on the run's own record. */
    val head: Pair<String, String>?,
    val bug: RecordBug,
    /** The position chips, "All" first; none with one position. */
    val positions: List<String>,
    /** The figure chips, capitalized: "Order matched", "Places off", "Starters right". */
    val figures: List<String>,
    val sourceHeads: List<String>,
    val before: Pair<String, String>?,
    val rows: List<RecordRow>,
    val toDate: RecordToDate?,
    val basis: String,
)

/** One figure of a draft line: ours and ADP as their cells print them, and whether ours is accented. */
data class DraftCell(
    val accented: Boolean,
    val ours: String,
    val adp: String,
)

/** One position's line of the draft record: ours and ADP for each figure. */
data class DraftRow(
    val position: String,
    val players: Int,
    val cells: Map<RecordFigure, DraftCell>,
)

/** A draft tile: its head, what it is, and the pair. */
data class DraftTile(
    val figure: RecordFigure,
    val label: String,
    val key: String?,
    val pair: FigurePair,
)

/** The draft record as DraftSection.svelte draws it at 390, or the line saying the next run writes it. */
data class DraftSectionModel(
    val title: String,
    val what: String,
    val waiting: String?,
    val span: String?,
    val players: String?,
    val tiles: List<DraftTile>,
    val honest: String?,
    val figures: List<String>,
    val rows: List<DraftRow>,
    val all: DraftRow?,
    val basis: String,
)

/** Our record as the record page draws it at 390 (routes/(run)/record/+page.svelte): the page's name and
 * lead, the weekly record (the run's own before Lane 114) and the draft record. Pure over the run's
 * record, its schedule and the clock. */
data class RecordModel(
    val title: String,
    val lead: String,
    val weekly: RecordSectionModel,
    val draft: DraftSectionModel,
)

fun recordModel(
    run: RunRecord,
    schedule: RunSchedule,
    scoring: String,
    now: Instant,
): RecordModel {
    val weeklyRecord = run.weekly
    if (weeklyRecord != null) {
        val book = RecordBook.weekly(weeklyRecord)
        return RecordModel(
            title = AppWords.record,
            lead = Words.Records.lead,
            weekly =
                RecordSections.weekly(
                    book,
                    weeklyRecord.fromWeek,
                    WeekStates.of(book, schedule, now),
                    NextGrade.of(book, schedule),
                ),
            draft = RecordSections.draft(run),
        )
    }
    val own = RecordBook.own(run)
    return RecordModel(
        title = AppWords.record,
        lead = RecordSections.lead(own, scoring),
        weekly = RecordSections.weekly(own, null, WeekStates.of(own, schedule, now), null),
        draft = RecordSections.draft(run),
    )
}
