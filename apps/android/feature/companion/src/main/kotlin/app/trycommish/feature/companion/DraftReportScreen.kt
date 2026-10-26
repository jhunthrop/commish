package app.trycommish.feature.companion

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.trycommish.core.Format
import app.trycommish.core.board.GapTone
import app.trycommish.core.companion.DraftReportModel
import app.trycommish.core.companion.ExposureLine
import app.trycommish.core.companion.FieldLine
import app.trycommish.core.companion.ReportCell
import app.trycommish.core.companion.ReportPickLine
import app.trycommish.core.companion.ReportRunsModel
import app.trycommish.core.shell.SheetPlayer
import app.trycommish.design.CommishTheme
import app.trycommish.design.Faces
import app.trycommish.design.NumWeight
import app.trycommish.design.PositionPill
import app.trycommish.design.Tokens
import app.trycommish.design.Verb
import app.trycommish.design.Words
import app.trycommish.feature.board.SmallCaps
import app.trycommish.feature.board.gapInk
import app.trycommish.feature.boxscore.BasisText

/** A part of the report, so a snapshot can frame the one it is of. */
enum class ReportPart { Head, Picks, Runs }

private object ReportSize {
    val pick = 36.dp
    val figure = 50.dp
    val later = 50.dp
    val rank = 20.dp
    val name = 128.dp
    val points = 48.dp
    val bar = 8.dp
    val row = 24.dp
    val histogram = 64.dp
    val rankCell = 34.dp
    val exposureBar = 60.dp
    val exposureFigure = 44.dp
    const val CELL_COLUMNS = 3
}

/** The report on the finished draft as a box score (Report.svelte at 390): the one big number and its
 * caption, the title, the finish and the draft as cells, the verb, the basis once, the field, pick by pick,
 * the same draft run again and who the runs land. */
@Composable
fun DraftReportScreen(
    report: DraftReportModel,
    actions: CompanionActions,
    modifier: Modifier = Modifier,
    parts: Set<ReportPart> = ReportPart.entries.toSet(),
) {
    Column(modifier.padding(vertical = Tokens.Space.s4.dp), verticalArrangement = Arrangement.spacedBy(Tokens.Space.s4.dp)) {
        if (ReportPart.Head in parts) Head(report, actions)
        if (ReportPart.Picks in parts) PickByPick(report.picksNote, report.picks, actions.open)
        if (ReportPart.Runs in parts) {
            Runs(report.runs)
            Exposure(report.exposureTitle, report.exposureAside, report.exposure, actions.open)
        }
    }
}

@Composable
private fun Head(
    report: DraftReportModel,
    actions: CompanionActions,
) {
    val c = CommishTheme.colors
    Column(Modifier.padding(horizontal = Tokens.Space.s3.dp), verticalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp)) {
        report.points?.let {
            Text(it, style = Faces.number(NumWeight.Bold, Tokens.Type.xxxl.sp), color = c.ink)
            NoteText(report.caption)
        }
        Text(
            report.title.uppercase(),
            style = Faces.number(NumWeight.Bold, Tokens.Type.xl.sp),
            color = c.ink,
            modifier = Modifier.semantics { heading() },
        )
        CellGrid(report.cells)
        Verb(Words.Companion.followAnother, onClick = actions.followAnother)
    }
    Box(Modifier.padding(horizontal = Tokens.Space.s3.dp)) { BasisText(report.basis) }
    Field(report.fieldNote, report.field)
}

/** The finish and the draft as cells (FactStrip.svelte): value over label, the seat's own in the accent. */
@Composable
private fun CellGrid(cells: List<ReportCell>) {
    val c = CommishTheme.colors
    Column(verticalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp)) {
        cells.chunked(ReportSize.CELL_COLUMNS).forEach { row ->
            Row(Modifier.fillMaxWidth()) {
                row.forEach { cell ->
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(1.dp)) {
                        Text(cell.value, style = Faces.number(NumWeight.Bold), color = if (cell.mine) c.accentText else c.ink, maxLines = 2)
                        HeadText(cell.label, end = false)
                    }
                }
                repeat(ReportSize.CELL_COLUMNS - row.size) { Spacer(Modifier.weight(1f)) }
            }
        }
    }
}

/** The field (FieldBars.svelte): each team's place, name, bar and points, yours in the accent. */
@Composable
private fun Field(
    note: String,
    field: List<FieldLine>,
) {
    val c = CommishTheme.colors
    Column(Modifier.padding(horizontal = Tokens.Space.s3.dp), verticalArrangement = Arrangement.spacedBy(Tokens.Space.s1.dp)) {
        SectionHead(Words.Report.field, note)
        field.forEach { team ->
            val ink = if (team.you) c.accentText else c.ink
            Row(
                Modifier.fillMaxWidth().height(ReportSize.row),
                horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    team.rank.toString(),
                    style = Faces.number(NumWeight.Bold, Tokens.Type.sm.sp),
                    color = ink,
                    modifier = Modifier.width(ReportSize.rank),
                )
                Text(
                    team.name,
                    style = Faces.small.copy(fontWeight = if (team.you) FontWeight.Bold else FontWeight.Normal),
                    color = ink,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.width(ReportSize.name),
                )
                val bar = if (team.you) c.accent else c.lineStrong
                Canvas(Modifier.weight(1f).height(ReportSize.bar)) {
                    drawRoundRect(
                        bar,
                        size = Size(size.width * team.share.toFloat(), size.height),
                        cornerRadius =
                            CornerRadius(
                                size.height / 2,
                            ),
                    )
                }
                FigureText(team.points, ReportSize.points, ink = ink, style = Faces.number(NumWeight.SemiBold, Tokens.Type.sm.sp))
            }
        }
    }
}

/** Pick by pick at 390 (PickReview.svelte, the phone's columns): the pick, the player with who made it,
 * Over repl, Picks later against ADP and against our board in their tones, Still there. */
@Composable
private fun PickByPick(
    note: String,
    picks: List<ReportPickLine>,
    open: (SheetPlayer) -> Unit,
) {
    val c = CommishTheme.colors
    Column(Modifier.padding(horizontal = Tokens.Space.s3.dp)) {
        SectionHead(Words.Report.pickByPick, note, Modifier.padding(bottom = Tokens.Space.s2.dp))
        Row(
            Modifier.fillMaxWidth().heightIn(min = ReportSize.rankCell).clearAndSetSemantics {},
            horizontalArrangement = Arrangement.spacedBy(4.dp),
            verticalAlignment = Alignment.Bottom,
        ) {
            HeadText(Words.Report.pick, Modifier.width(ReportSize.pick), end = false)
            HeadText(Words.Report.player, Modifier.weight(1f), end = false)
            HeadText(Words.Report.overRepl, Modifier.width(ReportSize.figure))
            HeadText("${Words.Report.adp} ${Words.Report.picksLater}", Modifier.width(ReportSize.later), lines = 3)
            HeadText("${Words.Report.ours} ${Words.Report.picksLater}", Modifier.width(ReportSize.later), lines = 3)
            HeadText(Words.Report.stillThere, Modifier.width(ReportSize.later))
        }
        picks.forEach { line ->
            RowRule()
            PickLine(line, open)
        }
    }
}

@Composable
private fun PickLine(
    line: ReportPickLine,
    open: (SheetPlayer) -> Unit,
) {
    val c = CommishTheme.colors
    Row(
        Modifier.fillMaxWidth().opens(line.player, open).padding(vertical = 6.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            line.pick,
            style = Faces.number(NumWeight.SemiBold, Tokens.Type.sm.sp),
            color = c.ink,
            modifier = Modifier.width(ReportSize.pick),
        )
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(line.name, style = Faces.small.copy(fontWeight = FontWeight.SemiBold), color = c.ink, maxLines = 2)
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
                line.player?.let {
                    PositionPill(it.pill)
                    SmallCaps(it.team)
                }
                Text(
                    line.madeBy,
                    style = Faces.label.copy(letterSpacing = 0.sp, fontWeight = if (line.mine) FontWeight.SemiBold else FontWeight.Normal),
                    color = if (line.mine) c.ink else c.ink3,
                    maxLines = 1,
                )
            }
        }
        val body = Faces.number(NumWeight.SemiBold, Tokens.Type.md.sp)
        FigureText(
            line.figure.text,
            ReportSize.figure,
            ink = if (line.figure.muted) c.ink3 else c.ink,
            style = if (line.figure.muted) Faces.label else body,
        )
        FigureText(line.adp?.text.orEmpty(), ReportSize.later, ink = toneInk(line.adp?.tone), style = body)
        FigureText(line.ours?.text.orEmpty(), ReportSize.later, ink = toneInk(line.ours?.tone), style = body)
        val still = line.still
        FigureText(
            still.text,
            ReportSize.later,
            ink =
                when {
                    still.wait -> c.accentText
                    still.muted -> c.ink3
                    else -> c.ink
                },
            style = if (still.muted) Faces.label else body,
        )
    }
}

/** The Picks later tone: plus is later than his place, green; minus rose. */
@Composable
private fun toneInk(tone: GapTone?): Color = gapInk(tone)

/** The same draft run again (RunsSection.svelte): the histogram with its median bar, the low, median and
 * high under it, the three figures, and how often each place came up, the draft's own ringed. */
@Composable
private fun Runs(runs: ReportRunsModel) {
    val c = CommishTheme.colors
    val peak = maxOf(runs.bins.maxOrNull() ?: 1, 1)
    Column(Modifier.padding(horizontal = Tokens.Space.s3.dp), verticalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp)) {
        SectionHead(runs.title, runs.note)
        Canvas(Modifier.fillMaxWidth().height(ReportSize.histogram).clearAndSetSemantics {}) {
            val gap = 3.dp.toPx()
            val width = (size.width - gap * (runs.bins.size - 1)) / runs.bins.size
            runs.bins.forEachIndexed { index, count ->
                val height = maxOf(2.dp.toPx(), size.height * count / peak)
                drawRoundRect(
                    if (index == runs.medianBin) c.accent else c.lineStrong,
                    Offset(index * (width + gap), size.height - height),
                    Size(width, height),
                    CornerRadius(2.dp.toPx()),
                )
            }
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            listOf(runs.low, "${Words.Report.median} ${runs.median}", runs.high).forEach {
                Text(it.uppercase(), style = Faces.label, color = c.ink3, maxLines = 1)
            }
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s3.dp)) {
            Stat(runs.median, Words.Report.medianPoints, Modifier.weight(1f))
            Stat(runs.middle, Words.Report.middleRuns, Modifier.weight(1f))
            Stat(runs.topShare, runs.topWords, Modifier.weight(1f))
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(2.dp)) {
            runs.ranks.forEachIndexed { index, count ->
                val ring =
                    if (index + 1 ==
                        runs.rank
                    ) {
                        Modifier.border(2.dp, c.accent, RoundedCornerShape(Tokens.Radius.sm.dp))
                    } else {
                        Modifier
                    }
                Column(
                    Modifier.weight(1f).heightIn(min = ReportSize.rankCell).then(ring),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Text(count.toString(), style = Faces.number(NumWeight.Bold, Tokens.Type.sm.sp), color = c.ink)
                    Text(
                        Format.ordinal(index + 1),
                        style = Faces.label.copy(fontSize = ORDINAL_SIZE, fontWeight = FontWeight.Normal),
                        color = c.ink3,
                    )
                }
            }
        }
    }
}

private val ORDINAL_SIZE = 9.sp

@Composable
private fun Stat(
    value: String,
    words: String,
    modifier: Modifier,
) {
    val c = CommishTheme.colors
    Column(modifier, verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(value, style = Faces.number(NumWeight.Bold), color = c.ink, maxLines = 1)
        Text(words, style = Faces.label.copy(fontWeight = FontWeight.Normal, letterSpacing = 0.sp), color = c.ink3)
    }
}

/** Who the runs land (Exposure.svelte): each player with his share of the runs. */
@Composable
private fun Exposure(
    title: String,
    aside: String,
    lines: List<ExposureLine>,
    open: (SheetPlayer) -> Unit,
) {
    val c = CommishTheme.colors
    Panel {
        SectionHead(title, aside, Modifier.padding(bottom = Tokens.Space.s2.dp))
        lines.forEach { line ->
            RowRule()
            Row(
                Modifier.fillMaxWidth().opens(line.player, open).padding(vertical = 4.dp),
                horizontalArrangement = Arrangement.spacedBy(Widths.gap),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                PlayerFace(line.player)
                WhoCell(line.player, Modifier.weight(1f))
                Canvas(Modifier.width(ReportSize.exposureBar).height(6.dp)) {
                    drawRoundRect(
                        c.accent,
                        size = Size(size.width * line.share.toFloat(), size.height),
                        cornerRadius =
                            CornerRadius(
                                size.height / 2,
                            ),
                    )
                }
                FigureText(line.percent, ReportSize.exposureFigure, style = Faces.number(NumWeight.SemiBold, Tokens.Type.md.sp))
            }
        }
    }
}
