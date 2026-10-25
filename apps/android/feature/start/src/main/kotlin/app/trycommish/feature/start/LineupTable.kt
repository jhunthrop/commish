package app.trycommish.feature.start

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.trycommish.core.start.StartModel
import app.trycommish.design.CommishTheme
import app.trycommish.design.Faces
import app.trycommish.design.NumWeight
import app.trycommish.design.Tokens
import app.trycommish.design.Words
import app.trycommish.feature.boxscore.BoxColumn
import app.trycommish.feature.boxscore.BoxRow
import app.trycommish.feature.boxscore.Figure
import app.trycommish.feature.boxscore.Hairline
import app.trycommish.feature.boxscore.HeadRow
import app.trycommish.feature.boxscore.NoteRow
import app.trycommish.feature.boxscore.RowActions
import app.trycommish.feature.boxscore.SectionRow
import app.trycommish.feature.boxscore.TableFrame
import app.trycommish.feature.boxscore.TeamRowView
import app.trycommish.feature.boxscore.idleGround

/** The Lineup's one table (web LineupTable.svelte): the heads, the lineup the advice sets with its
 * evidence lines, the spots no one can play, the Team row lit like the score bug. */
@Composable
internal fun LineupTable(
    model: StartModel,
    actions: RowActions,
) {
    TableFrame {
        HeadRow()
        model.starters.forEach { BoxRow(it, bench = false, actions = actions) }
        model.empty.forEach { EmptyRow(it) }
        TeamRowView(model.team)
    }
}

/** The bench and the injured reserve (the table's second and third bodies on the web). */
@Composable
internal fun BenchTable(
    model: StartModel,
    actions: RowActions,
) {
    TableFrame {
        SectionRow(Words.Box.bench)
        if (model.bench.isEmpty()) NoteRow(Words.InSeason.noBench)
        model.bench.forEach { BoxRow(it, bench = true, actions = actions) }
        if (model.reserve.isNotEmpty()) {
            SectionRow(Words.Box.reserve)
            model.reserve.forEach { BoxRow(it, bench = true, actions = actions) }
        }
    }
}

/** A spot empty on the platform that no one who can play fills: its slot, the sentence, no figures. */
@Composable
private fun EmptyRow(slot: String) {
    val c = CommishTheme.colors
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 48.dp)
            .background(idleGround())
            .padding(horizontal = Tokens.Space.s2.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            slot,
            style = Faces.number(NumWeight.Bold, Tokens.Type.md.sp),
            color = c.ink2,
            modifier = Modifier.width(BoxColumn.slot),
        )
        Text(Words.Lineup.noOneHere, style = Faces.small, color = c.ink3, modifier = Modifier.weight(1f))
        Figure(Words.Box.none, BoxColumn.proj, muted = true)
        Figure(Words.Box.none, BoxColumn.pts, muted = true)
        Spacer(Modifier.width(BoxColumn.why))
    }
    Hairline()
}
