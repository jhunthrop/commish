package app.trycommish.feature.companion

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.trycommish.core.board.BoardChip
import app.trycommish.core.companion.CallModel
import app.trycommish.core.companion.CompanionBar
import app.trycommish.core.companion.PoolModel
import app.trycommish.core.companion.RoomWords
import app.trycommish.core.companion.ShortlistLine
import app.trycommish.core.companion.TeamModel
import app.trycommish.core.shell.SheetPlayer
import app.trycommish.design.CommishTheme
import app.trycommish.design.Faces
import app.trycommish.design.NumWeight
import app.trycommish.design.QuietButton
import app.trycommish.design.Tokens
import app.trycommish.design.Verb
import app.trycommish.design.Words
import app.trycommish.feature.boxscore.BasisText
import app.trycommish.feature.boxscore.ChipRow
import app.trycommish.feature.boxscore.RangeBar

private val HEAD_ROW = 28.dp
private val POOL_ROW = 52.dp
private val SHORTLIST_FACE = 40.dp
private val RANGE_WIDTH = 360.dp
private val TEAM_ROW = 44.dp
private val OPEN_ROW = 30.dp

/** The companion's head (CompanionBar.svelte at 390): the platform's pick count, big, where a mock room's
 * clock would be, the draft and the league, when you are up (in the accent at your turn), the platform gone
 * quiet, and the way back to its draft room. */
@Composable
internal fun CompanionBarView(
    bar: CompanionBar,
    openDraft: () -> Unit,
) {
    val c = CommishTheme.colors
    Panel(if (bar.onTurn) Edge.Accent else Edge.Plain) {
        Text(bar.figure, style = Faces.number(NumWeight.Bold, Tokens.Type.display.sp), color = c.ink)
        Text(bar.caption, style = Faces.label.copy(letterSpacing = 0.sp), color = c.ink3)
        Text(
            bar.title.uppercase(),
            style = Faces.number(NumWeight.Bold, Tokens.Type.lg.sp),
            color = c.ink,
            modifier = Modifier.padding(top = Tokens.Space.s2.dp).semantics { heading() },
        )
        NoteText(bar.league)
        Text(
            bar.turn,
            style = Faces.small.copy(fontWeight = if (bar.onTurn) FontWeight.Bold else FontWeight.Normal),
            color = if (bar.onTurn) c.accentText else c.ink2,
        )
        bar.stale?.let { NoteText(it, ink = c.lossInk) }
        QuietButton(bar.open, onClick = openDraft)
    }
}

/** The heads over a call's or the pool's rows: Player, Over repl, and the chance's head where one is drawn. */
@Composable
private fun ColumnHeads(chanceHead: String?) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = HEAD_ROW).padding(start = Widths.face + Widths.gap),
        horizontalArrangement = Arrangement.spacedBy(Widths.gap),
        verticalAlignment = Alignment.Bottom,
    ) {
        HeadText(Words.Room.player, Modifier.weight(1f), end = false)
        HeadText(Words.Room.overRepl, Modifier.widthIn(max = Widths.value))
        chanceHead?.let { HeadText(it, Modifier.widthIn(max = Widths.chance)) }
    }
}

/** Our call (CallPanel.svelte at 390): its tag, the heads, the call first then the next two, and the one
 * verb: solid at your turn, quiet while the call waits on the board. */
@Composable
internal fun CallPanelView(
    call: CallModel,
    open: (SheetPlayer) -> Unit,
    press: () -> Unit,
) {
    val c = CommishTheme.colors
    Panel(if (call.waiting) Edge.Quiet else Edge.Accent) {
        Text(
            call.tag.uppercase(),
            style = Faces.label.copy(fontWeight = FontWeight.Bold),
            color = if (call.waiting) c.ink3 else c.accentText,
            modifier = Modifier.padding(bottom = Tokens.Space.s2.dp),
        )
        ColumnHeads(call.chanceHead ?: "")
        call.rows.forEachIndexed { index, row ->
            RowRule()
            Row(
                Modifier
                    .fillMaxWidth()
                    .background(if (index == 0 && !call.waiting) c.accentWash else Color.Transparent)
                    .opens(row.player, open)
                    .padding(vertical = 6.dp),
                horizontalArrangement = Arrangement.spacedBy(Widths.gap),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                PlayerFace(row.player)
                WhoCell(row.player, Modifier.weight(1f))
                FigureText(
                    row.value,
                    Widths.value,
                    ink = if (row.player.isMarket) c.ink3 else c.ink2,
                    style = if (row.player.isMarket) Faces.label else Faces.cell,
                )
                FigureText(row.chance, Widths.chance, style = Faces.figure)
            }
        }
        Box(Modifier.padding(top = Tokens.Space.s2.dp)) {
            if (call.waiting) QuietButton(call.verb, onClick = press) else Verb(call.verb, onClick = press)
        }
    }
}

/** Who we would take next (Shortlist.svelte): each player after the call with his chance of lasting, our
 * why's first sentence under his name, and his outcome range on the list's shared scale. */
@Composable
internal fun ShortlistView(
    lines: List<ShortlistLine>,
    open: (SheetPlayer) -> Unit,
) {
    Panel {
        SectionHead(Words.Companion.nextTitle, Words.Companion.nextAside, Modifier.padding(bottom = Tokens.Space.s2.dp))
        lines.forEach { line ->
            RowRule()
            Row(
                Modifier.fillMaxWidth().opens(line.player, open).padding(vertical = 6.dp),
                horizontalArrangement = Arrangement.spacedBy(Widths.gap),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                PlayerFace(line.player, SHORTLIST_FACE)
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Tokens.Space.s1.dp)) {
                    WhoCell(line.player)
                    line.why?.let { NoteText(it) }
                    line.range?.let { RangeBar(it.left, it.width, it.mid, it.text, Modifier.widthIn(max = RANGE_WIDTH)) }
                }
                ChanceCell(line.chance, line.label, RoomWords.chanceMissing(gone = false, read = true))
            }
        }
    }
}

/** The pool (Pool.svelte at 390): its title and count, the chips, the basis over it, the heads, the rows
 * (our call washed), more on a tap. */
@Composable
internal fun PoolView(
    pool: PoolModel,
    shown: Int,
    actions: CompanionActions,
    still: Boolean,
) {
    val c = CommishTheme.colors
    Column(verticalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp)) {
        SectionHead(Words.Room.pool, pool.line, Modifier.padding(horizontal = Tokens.Space.s3.dp))
        Box(Modifier.padding(horizontal = Tokens.Space.s3.dp)) {
            ChipRow(pool.chips.map(BoardChip<String>::pair), pool.filter, actions.filter, still = still, label = Words.Room.pool)
        }
        Box(Modifier.padding(horizontal = Tokens.Space.s3.dp)) { BasisText(pool.basis) }
        Column {
            Box(Modifier.padding(horizontal = Tokens.Space.s2.dp)) { ColumnHeads(pool.chanceHead) }
            RowRule()
            pool.rows.take(shown).forEach { row ->
                Row(
                    Modifier
                        .fillMaxWidth()
                        .heightIn(min = POOL_ROW)
                        .background(if (row.isCall) c.accentWash else c.surface)
                        .opens(row.player, actions.open)
                        .padding(horizontal = Tokens.Space.s2.dp, vertical = 6.dp),
                    horizontalArrangement = Arrangement.spacedBy(Widths.gap),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    PlayerFace(row.player)
                    WhoCell(row.player, Modifier.weight(1f))
                    ValueCell(row.value, row.heat)
                    if (pool.chanceHead != null) ChanceCell(row.chance, pool.chanceLabel, pool.missing)
                }
                RowRule()
            }
            pool.empty?.let { NoteText(it, Modifier.padding(Tokens.Space.s3.dp)) }
        }
        pool.more(shown)?.let { QuietButton(it, Modifier.padding(horizontal = Tokens.Space.s3.dp), onClick = actions.more) }
    }
}

/** A chip as the shared row takes it: its words and what it chooses. */
private fun <Value> BoardChip<Value>.pair(): Pair<String, Value> = label to value

/** Your team (TeamPanel.svelte): the count, then each slot with who fills it and the pick that took him, or
 * open. */
@Composable
internal fun TeamView(
    team: TeamModel,
    open: (SheetPlayer) -> Unit,
) {
    val c = CommishTheme.colors
    Panel {
        SectionHead(Words.Room.yourTeam, team.count, Modifier.padding(bottom = Tokens.Space.s2.dp))
        team.slots.forEach { line ->
            RowRule()
            Row(
                Modifier.fillMaxWidth().heightIn(min = if (line.player == null) OPEN_ROW else TEAM_ROW).opens(line.player, open),
                horizontalArrangement = Arrangement.spacedBy(Widths.gap),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    line.slot,
                    style = Faces.label.copy(fontWeight = FontWeight.Bold),
                    color = c.ink3,
                    modifier = Modifier.width(Widths.slot),
                )
                val player = line.player
                if (player == null) {
                    Text(Words.Room.open, style = Faces.label.copy(fontWeight = FontWeight.Normal, letterSpacing = 0.sp), color = c.ink3)
                } else {
                    PlayerFace(player)
                    WhoCell(player, Modifier.weight(1f))
                    FigureText(line.pick.orEmpty(), Widths.pick, ink = c.ink2, style = Faces.small)
                }
            }
        }
    }
}
