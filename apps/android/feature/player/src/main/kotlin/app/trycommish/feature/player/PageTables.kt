package app.trycommish.feature.player

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.trycommish.core.player.FormatsTable
import app.trycommish.core.player.SeasonView
import app.trycommish.core.player.TierBox
import app.trycommish.design.CommishTheme
import app.trycommish.design.Faces
import app.trycommish.design.NumWeight
import app.trycommish.design.R
import app.trycommish.design.Tokens
import app.trycommish.design.Words

/** The week and opponent's column; the figures share the rest of the width. */
private const val PINNED = 76

/** A head row's and a figure row's least height, a week still to play's, a tier mate's. */
private const val HEAD_HEIGHT = 28
private const val ROW_HEIGHT = 34
private const val AHEAD_HEIGHT = 32
private const val MATE_HEIGHT = 40
private const val TOGGLE_HEIGHT = 44
private const val WEEK_WIDTH = 28
private const val CHEVRON = 16
private const val CLOSED_TURN = -90f

/** A line of the game log or a table: the pinned lead and its sub, then each figure in its column. */
private data class LogCells(
    val lead: String,
    val sub: String,
    val values: List<String>,
)

/**
 * His season (the page's "This season" over GameLog.svelte at 390): the head with its aside, the game log
 * (the week and opponent pinned, then Pts and the position's columns), the season line, his earlier seasons
 * folded under it, and the weeks still to play with their days; the one sentence in the log's place with
 * no line.
 */
@Composable
fun SeasonBlock(season: SeasonView) {
    val c = CommishTheme.colors
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Tokens.Space.s3.dp)) {
        PanelTitle(Words.PlayerPage.thisSeason, season.aside)
        val line = season.line
        if (line == null) {
            Text(season.none, style = Faces.body, color = c.ink2)
        } else {
            Column {
                LogLine(
                    LogCells(Words.Figure.week, Words.Box.opp, listOf(season.pointsHead.short) + season.heads.map { it.short }),
                    head = true,
                )
                season.rows.forEach { row ->
                    val sub = if (row.note.isEmpty()) row.opponent else "${row.opponent} ${row.note}"
                    LogLine(
                        LogCells(row.week.toString(), sub, listOf(row.points.orEmpty()) + row.cells.orEmpty()),
                        quiet =
                            row.tone != SeasonView.Tone.Played,
                    )
                }
                LogLine(LogCells(line.lead, line.sub, listOf(line.total) + line.cells.map { it.value }), total = true)
                if (season.prior.isNotEmpty()) EarlierSeasons(season.prior)
            }
        }
        if (season.ahead.isNotEmpty()) StillToPlay(season.ahead)
        season.basis?.let { BasisLines(listOf(it)) }
    }
}

/** His earlier seasons, folded under the season line until opened. */
@Composable
private fun EarlierSeasons(prior: List<SeasonView.Prior>) {
    var open by rememberSaveable { mutableStateOf(false) }
    val c = CommishTheme.colors
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = TOGGLE_HEIGHT.dp)
            .clickable(role = Role.Button) { open = !open }
            .semantics { stateDescription = if (open) "open" else "closed" },
        horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s1.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            painterResource(R.drawable.icon_chevron),
            contentDescription = null,
            tint = c.ink2,
            modifier = Modifier.size(CHEVRON.dp).rotate(if (open) 0f else CLOSED_TURN),
        )
        Text(Words.Card.earlierSeasons, style = Faces.small.copy(fontWeight = FontWeight.SemiBold), color = c.ink2)
    }
    if (open) prior.forEach { LogLine(LogCells(it.season.toString(), it.sub, listOf(it.total) + it.cells)) }
}

/** The weeks still to play, each with its day or the game's state. */
@Composable
private fun StillToPlay(ahead: List<SeasonView.Ahead>) {
    val c = CommishTheme.colors
    Column {
        SmallHead(Words.PlayerPage.stillToPlay, Modifier.semantics { heading() })
        ahead.forEach { week ->
            val ink = if (week.bye) c.ink3 else c.ink
            Row(
                Modifier.fillMaxWidth().heightIn(min = AHEAD_HEIGHT.dp),
                horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(week.week.toString(), style = Faces.number(NumWeight.Bold), color = ink, modifier = Modifier.width(WEEK_WIDTH.dp))
                Text(
                    week.opponent,
                    style = Faces.small.copy(fontWeight = if (week.bye) FontWeight.Normal else FontWeight.SemiBold),
                    color = ink,
                    modifier = Modifier.weight(1f),
                )
                Text(week.day, style = Faces.small, color = ink)
            }
            HorizontalDivider(color = c.line)
        }
    }
}

/** One line of the log or a table: the pinned lead and its sub, then each figure in its column. */
@Composable
private fun LogLine(
    cells: LogCells,
    head: Boolean = false,
    quiet: Boolean = false,
    total: Boolean = false,
    /** The first figure's share of the row: a log's Pts is wider than its columns, a table's rank is not. */
    leadWeight: Float = LEAD_FIGURE_WEIGHT,
) {
    val c = CommishTheme.colors
    val ink = if (head || quiet) c.ink3 else c.ink
    Column {
        Row(
            Modifier.fillMaxWidth().heightIn(min = (if (head) HEAD_HEIGHT else ROW_HEIGHT).dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            LeadCell(cells, head, total, ink)
            cells.values.forEachIndexed { index, value ->
                val style =
                    when {
                        head -> Faces.label.copy(fontWeight = FontWeight.Bold, letterSpacing = 0.sp)
                        else -> Faces.number(if (index == 0) NumWeight.Bold else NumWeight.Medium)
                    }
                FitText(
                    if (head) value.uppercase() else value,
                    style = style,
                    color = ink,
                    textAlign = TextAlign.End,
                    maxLines = if (head) HEAD_LINES else 1,
                    modifier = Modifier.weight(if (index == 0) leadWeight else 1f).padding(start = 2.dp),
                )
            }
        }
        HorizontalDivider(color = c.line)
    }
}

private const val HEAD_LINES = 3

/** The first figure (Pts, a total) takes more of the row, so a season total prints whole. */
private const val LEAD_FIGURE_WEIGHT = 1.5f

/** The pinned lead: a week beside its opponent, a total's sub under its lead. */
@Composable
private fun LeadCell(
    cells: LogCells,
    head: Boolean,
    total: Boolean,
    ink: Color,
) {
    val leadStyle = if (head) Faces.label.copy(fontWeight = FontWeight.Bold) else Faces.number(NumWeight.Bold)
    val subStyle = Faces.label.copy(fontWeight = if (total) FontWeight.SemiBold else FontWeight.Normal)
    val lead = if (head) cells.lead.uppercase() else cells.lead
    val sub = if (head) cells.sub.uppercase() else cells.sub
    if (total) {
        Column(Modifier.width(PINNED.dp)) {
            Text(lead, style = leadStyle, color = ink)
            Text(sub, style = subStyle, color = ink, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
    } else {
        Row(
            Modifier.width(PINNED.dp),
            horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s1.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (lead.isNotEmpty()) Text(lead, style = leadStyle, color = ink)
            Text(sub, style = subStyle, color = ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

/** The tier box (TierMates.svelte): the band with his tier and the line under it, his tier's players with
 * their figures (his own marked), and the basis at its foot. */
@Composable
fun TierBoxView(box: TierBox) {
    val c = CommishTheme.colors
    val shape = RoundedCornerShape(Tokens.Radius.md.dp)
    Column(
        Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(c.surface)
            .border(1.dp, c.line, shape),
    ) {
        Column(Modifier.padding(Tokens.Space.s3.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(
                box.title,
                style = Faces.body.copy(fontWeight = FontWeight.Bold),
                color = c.ink,
                modifier = Modifier.semantics { heading() },
            )
            box.drop?.let { Text(it, style = Faces.label.copy(fontWeight = FontWeight.Normal), color = c.ink3) }
        }
        box.mates.forEach { mate ->
            HorizontalDivider(color = c.line)
            Row(
                Modifier
                    .fillMaxWidth()
                    .background(if (mate.current) c.accentWash else Color.Transparent)
                    .heightIn(min = MATE_HEIGHT.dp)
                    .padding(horizontal = Tokens.Space.s3.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Text(
                        mate.name,
                        style = Faces.small.copy(fontWeight = if (mate.current) FontWeight.Bold else FontWeight.Medium),
                        color = c.ink,
                    )
                    Text(
                        listOfNotNull(mate.team, mate.span).joinToString(", "),
                        style = Faces.label.copy(fontWeight = FontWeight.Normal),
                        color = c.ink3,
                    )
                }
                Text(mate.projected, style = Faces.number(NumWeight.Bold), color = c.ink)
            }
        }
        HorizontalDivider(color = c.line)
        Text(box.basis, style = Faces.small, color = c.ink3, modifier = Modifier.padding(Tokens.Space.s3.dp))
    }
}

/** The every-format table (Table.svelte): each format with our rank, his points, his value over a
 * pickup's and his tier, and why the formats need not line up. */
@Composable
fun FormatsTableView(table: FormatsTable) {
    Column(Modifier.fillMaxWidth()) {
        val heads = listOf(Words.Box.ourRank, table.head, Words.PlayerPage.overReplacement, Words.PlayerPage.tier)
        LogLine(LogCells(Words.PlayerPage.format, "", heads), head = true, leadWeight = 1f)
        table.rows.forEach { LogLine(LogCells("", it.label, listOf(it.rank, it.points, it.vor, it.tier)), leadWeight = 1f) }
        table.note?.let { BasisLines(listOf(it)) }
    }
}
