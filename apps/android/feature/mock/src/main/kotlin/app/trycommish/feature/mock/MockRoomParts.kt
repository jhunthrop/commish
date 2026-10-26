package app.trycommish.feature.mock

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.trycommish.core.board.BoardChip
import app.trycommish.core.companion.CallModel
import app.trycommish.core.mock.MockCallState
import app.trycommish.core.mock.MockCell
import app.trycommish.core.mock.MockPool
import app.trycommish.core.mock.MockPoolLine
import app.trycommish.core.mock.MockSharedHead
import app.trycommish.design.CommishTheme
import app.trycommish.design.Faces
import app.trycommish.design.NumWeight
import app.trycommish.design.QuietButton
import app.trycommish.design.Tokens
import app.trycommish.design.Verb
import app.trycommish.design.Words
import app.trycommish.feature.boxscore.BasisText
import app.trycommish.feature.boxscore.ChipRow
import app.trycommish.feature.companion.ChanceCell
import app.trycommish.feature.companion.ColumnHeads
import app.trycommish.feature.companion.Edge
import app.trycommish.feature.companion.FigureText
import app.trycommish.feature.companion.NoteText
import app.trycommish.feature.companion.Panel
import app.trycommish.feature.companion.PlayerFace
import app.trycommish.feature.companion.RowRule
import app.trycommish.feature.companion.SectionHead
import app.trycommish.feature.companion.ValueCell
import app.trycommish.feature.companion.WhoCell
import app.trycommish.feature.companion.Widths

private val POOL_ROW = 52.dp

/** The reading skeleton's ink (RoomCall.svelte's frame while the next call is on its way). */
private const val READING_ALPHA = 0.55f

/** Our call (RoomCall.svelte, CallPanel.svelte at 390): its tag, the heads, the call first then the next two,
 * and the one verb; while the next call is on its way the last frame as a quiet skeleton with its words; with
 * no call coming, the line and the verb that drafts the pool's top row. */
@Composable
internal fun MockCallView(
    state: MockCallState,
    enabled: Boolean,
    draft: (String?) -> Unit,
) {
    when (state) {
        is MockCallState.Call ->
            CallFrame(state.call, state.call.tag, reading = false) {
                Verb(state.call.verb, enabled = enabled) { draft(state.playerId) }
            }
        is MockCallState.Reading ->
            CallFrame(
                state.call,
                state.words,
                reading = true,
            ) { Verb(Words.Room.waitingOnCall, enabled = false) {} }
        is MockCallState.NoCall ->
            Panel {
                Column(verticalArrangement = Arrangement.spacedBy(Tokens.Space.s3.dp)) {
                    NoteText(Words.Mock.noCall)
                    state.verb?.let { Verb(it, enabled = enabled) { draft(state.playerId) } }
                }
            }
    }
}

@Composable
private fun CallFrame(
    call: CallModel,
    tag: String,
    reading: Boolean,
    verb: @Composable () -> Unit,
) {
    val c = CommishTheme.colors
    Panel(if (reading || call.waiting) Edge.Quiet else Edge.Accent) {
        Column(Modifier.alpha(if (reading) READING_ALPHA else 1f)) {
            Text(
                tag.uppercase(),
                style = Faces.label.copy(fontWeight = FontWeight.Bold),
                color = if (reading) c.ink3 else c.accentText,
                modifier = Modifier.padding(bottom = Tokens.Space.s2.dp),
            )
            ColumnHeads(call.chanceHead ?: "")
            call.rows.forEachIndexed { index, row ->
                RowRule()
                Row(
                    Modifier
                        .fillMaxWidth()
                        .background(if (index == 0 && !reading) c.accentWash else Color.Transparent)
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
            Box(Modifier.padding(top = Tokens.Space.s2.dp)) { verb() }
        }
    }
}

/** The pool (Pool.svelte at 390): its title and count, the chips (Queue among them on your own draft), the
 * basis, the heads, the rows (our call and the marked row washed); a tap marks a row and shows its Queue and
 * Draft, as the web's phone row does. */
@Composable
internal fun MockPoolView(
    pool: MockPool,
    shown: Int,
    enabled: Boolean,
    actions: MockRoomActions,
    still: Boolean,
) {
    val c = CommishTheme.colors
    Column(verticalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp)) {
        SectionHead(Words.Room.pool, pool.model.line, Modifier.padding(horizontal = Tokens.Space.s3.dp))
        Box(Modifier.padding(horizontal = Tokens.Space.s3.dp)) {
            ChipRow(
                pool.chips.map(BoardChip<String>::pair),
                pool.model.filter,
                actions.filter,
                still = still,
                label = Words.Room.pool,
                keepChosen = true,
            )
        }
        Box(Modifier.padding(horizontal = Tokens.Space.s3.dp)) { BasisText(pool.model.basis) }
        Column {
            Box(Modifier.padding(horizontal = Tokens.Space.s2.dp)) { ColumnHeads(pool.model.chanceHead) }
            RowRule()
            pool.rows.take(shown).forEach { row ->
                MockPoolRow(
                    row,
                    pool,
                    enabled,
                    actions,
                    Modifier.background(
                        if (row.line.isCall ||
                            row.marked
                        ) {
                            c.accentWash
                        } else {
                            c.surface
                        },
                    ),
                )
                RowRule()
            }
            pool.empty?.let { NoteText(it, Modifier.padding(Tokens.Space.s3.dp)) }
        }
        pool.more(shown)?.let { QuietButton(it, Modifier.padding(horizontal = Tokens.Space.s3.dp), onClick = actions.more) }
    }
}

/** One pool row: face, player, Over repl on its tint, the chance; marked, its Queue and Draft under it. */
@Composable
private fun MockPoolRow(
    row: MockPoolLine,
    pool: MockPool,
    enabled: Boolean,
    actions: MockRoomActions,
    modifier: Modifier,
) {
    val tap =
        if (pool.readOnly) {
            Modifier
        } else {
            Modifier.clickable(role = Role.Button, onClickLabel = row.line.player.name) {
                actions.mark(row.id)
            }
        }
    Column(
        modifier
            .fillMaxWidth()
            .heightIn(min = POOL_ROW)
            .then(tap)
            .padding(horizontal = Tokens.Space.s2.dp, vertical = 6.dp),
        horizontalAlignment = Alignment.End,
        verticalArrangement = Arrangement.spacedBy(Tokens.Space.s1.dp),
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(Widths.gap), verticalAlignment = Alignment.CenterVertically) {
            PlayerFace(row.line.player)
            WhoCell(row.line.player, Modifier.weight(1f))
            ValueCell(row.line.value, row.line.heat)
            if (pool.model.chanceHead != null) ChanceCell(row.line.chance, pool.model.chanceLabel, pool.model.missing)
        }
        if (row.marked && !pool.readOnly) {
            Row(horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp), verticalAlignment = Alignment.CenterVertically) {
                QuietButton(if (row.queued) Words.Mock.queued else Words.Mock.queue) { actions.queue(row.id) }
                if (pool.draftShown) {
                    Verb(Words.Mock.draft, Modifier.fillMaxWidth(DRAFT_SHARE), enabled = enabled && pool.canDraft) { actions.draft(row.id) }
                }
            }
        }
    }
}

/** The marked row's Draft beside its Queue: a share of the row, not all of it. */
private const val DRAFT_SHARE = 0.4f

/** A chip as the shared row takes it: its words and what it chooses. */
private fun <Value> BoardChip<Value>.pair(): Pair<String, Value> = label to value

/** A shared draft's head (SharedHead.svelte): whose it is, where it stands, the one verb and its note. */
@Composable
internal fun MockSharedHeadView(
    head: MockSharedHead,
    starting: Boolean,
    run: () -> Unit,
) {
    val c = CommishTheme.colors
    Column(Modifier.padding(horizontal = Tokens.Space.s3.dp), verticalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp)) {
        Text(
            head.title.uppercase(),
            style = Faces.number(NumWeight.Bold, Tokens.Type.xl.sp),
            color = c.ink,
            modifier = Modifier.semantics { heading() },
        )
        NoteText(head.line)
        Verb(head.verb, enabled = !starting, onClick = run)
        BasisText(head.note)
    }
}

/** A fact strip (FactStrip.svelte): label under value, words in the words' face; wrapping as the web's
 * flex-wrap does, so a cell is never cut off at the phone's edge. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun Cells(
    cells: List<MockCell>,
    modifier: Modifier = Modifier,
    spacing: Double = Tokens.Space.s4,
) {
    val c = CommishTheme.colors
    FlowRow(
        modifier,
        horizontalArrangement = Arrangement.spacedBy(spacing.dp),
        verticalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp),
    ) {
        cells.forEach { cell ->
            Column(Modifier.align(Alignment.Bottom), verticalArrangement = Arrangement.spacedBy(1.dp)) {
                Text(
                    cell.value,
                    style = if (cell.word) Faces.body.copy(fontWeight = FontWeight.SemiBold) else Faces.figure,
                    color = c.ink,
                    maxLines = 1,
                )
                Text(cell.label.uppercase(), style = Faces.label, color = c.ink3, maxLines = 1)
            }
        }
    }
}
