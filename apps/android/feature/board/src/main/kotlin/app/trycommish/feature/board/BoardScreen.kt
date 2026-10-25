package app.trycommish.feature.board

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.wrapContentWidth
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import app.trycommish.core.AppWords
import app.trycommish.core.board.BoardChip
import app.trycommish.core.board.BoardModel
import app.trycommish.core.board.BoardPosition
import app.trycommish.core.board.BoardSection
import app.trycommish.core.board.BoardState
import app.trycommish.core.board.PageVerb
import app.trycommish.core.shell.SheetPlayer
import app.trycommish.design.CommishTheme
import app.trycommish.design.Faces
import app.trycommish.design.Tokens
import app.trycommish.design.Verb
import app.trycommish.feature.boxscore.ScreenFailed

/** What the screen's controls do: a row opens the player sheet, a chip chooses, a pull reads again,
 * the verb opens its page. */
class BoardActions(
    val open: (SheetPlayer) -> Unit = {},
    /** A format chip, by the run's format id ("ppr-12"). */
    val format: (String) -> Unit = {},
    val position: (BoardPosition?) -> Unit = {},
    val refresh: () -> Unit = {},
    val openPage: (String) -> Unit = {},
)

private val PIN_SHADOW = 8.dp

/**
 * The Board as the view model holds it (the iOS BoardView's twin): the board scrolling under the one
 * verb pinned above the bar; a pull reads again; over a board that could not be read the run's format
 * chips stay up, so the member can turn back to one that reads. The screen decides nothing: the state,
 * the stamp and the chips are the view model's.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BoardScreen(
    state: BoardState,
    stamp: String?,
    /** The format chips over a board that could not be read. */
    formats: List<BoardChip<String>>,
    refreshing: Boolean,
    actions: BoardActions,
    modifier: Modifier = Modifier,
) {
    val c = CommishTheme.colors
    Column(modifier.fillMaxSize().background(c.bg)) {
        PullToRefreshBox(isRefreshing = refreshing, onRefresh = actions.refresh, modifier = Modifier.weight(1f)) {
            when (state) {
                BoardState.Loading -> Box(Modifier.fillMaxSize(), Alignment.Center) { CircularProgressIndicator() }
                BoardState.SignedOut -> ScreenFailed(AppWords.signedOut, null)
                is BoardState.Failed ->
                    Column(Modifier.fillMaxSize().padding(top = Tokens.Space.s5.dp)) {
                        ChipRow(formats, actions.format)
                        ScreenFailed(state.message, actions.refresh)
                    }
                is BoardState.Loaded ->
                    LazyColumn(Modifier.fillMaxSize()) { board(state.model, stamp, actions, state.model.sections) }
            }
        }
        (state as? BoardState.Loaded)
            ?.model
            ?.words
            ?.verb
            ?.let { BoardPin(it) { actions.openPage(it.page) } }
    }
}

/** The board top to bottom, in the web's order at 390, as a lazy list's items: the head, the chips, the
 * column heads, each section under its band or head, the basis. */
private fun LazyListScope.board(
    model: BoardModel,
    stamp: String?,
    actions: BoardActions,
    sections: List<BoardSection>,
) {
    item("head") { BoardHead(model, stamp, Modifier.padding(top = Tokens.Space.s4.dp)) }
    item("chips") { BoardChips(model, actions) }
    item("heads") { BoardHeadRow(model.columns) }
    sections.forEach { section ->
        section.band?.let { band -> item("band-${section.id}") { TierStrip(band) } }
        section.head?.let { head -> item("head-${section.id}") { BoardSectionHead(head) } }
        items(section.rows, key = { "${section.id}-${it.id}" }) { BoardRowView(it, model.columns, actions.open) }
    }
    item("basis") { BoardBasis(model.basis, Modifier.padding(vertical = Tokens.Space.s4.dp)) }
}

/** The board drawn whole, with no scrolling: a snapshot's, over the sections it is given. */
@Composable
internal fun BoardPage(
    model: BoardModel,
    stamp: String?,
    sections: List<BoardSection>,
    modifier: Modifier = Modifier,
) {
    Column(modifier.background(CommishTheme.colors.bg).padding(top = Tokens.Space.s4.dp)) {
        BoardHead(model, stamp)
        BoardChips(model, BoardActions(), scrolls = false)
        BoardTable(model, sections)
        BoardBasis(model.basis, Modifier.padding(vertical = Tokens.Space.s4.dp))
    }
}

/** The column heads and the sections under them, drawn whole. */
@Composable
internal fun BoardTable(
    model: BoardModel,
    sections: List<BoardSection>,
) {
    Column {
        BoardHeadRow(model.columns)
        sections.forEach { section ->
            section.band?.let { TierStrip(it) }
            section.head?.let { BoardSectionHead(it) }
            section.rows.forEach { BoardRowView(it, model.columns) {} }
        }
    }
}

/** The board's head (web PageHead at 390): the heading in the number face, the run's stamp, in season
 * the weeks the board ranks, and over a saved board why it shows. */
@Composable
internal fun BoardHead(
    model: BoardModel,
    stamp: String?,
    modifier: Modifier = Modifier,
) {
    val c = CommishTheme.colors
    Column(modifier.fillMaxWidth().padding(horizontal = Tokens.Space.s3.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(
            model.words.heading.uppercase(),
            style = Faces.head.copy(fontSize = Faces.head.fontSize * DISPLAY_SCALE),
            color = c.ink,
            modifier = Modifier.semantics { heading() },
        )
        Text(model.stamp, style = Faces.label.copy(letterSpacing = Faces.small.letterSpacing), color = c.ink3)
        model.restLine?.let { Text(it, style = Faces.small.copy(fontWeight = FontWeight.Medium), color = c.ink2) }
        stamp?.let {
            Text(
                it,
                style = Faces.label.copy(letterSpacing = Faces.small.letterSpacing),
                color = c.accentText,
                modifier = Modifier.padding(top = Tokens.Space.s1.dp),
            )
        }
    }
}

/** Tokens.Type.display over Tokens.Type.head: the page title's size in the head's face. */
private const val DISPLAY_SCALE = Tokens.Type.display / Tokens.Type.head

/** The format chips (hidden when the run carries one) and the position chips, each a row that scrolls
 * sideways (ChipGroup.svelte). */
@Composable
internal fun BoardChips(
    model: BoardModel,
    actions: BoardActions,
    scrolls: Boolean = true,
) {
    Column(
        Modifier.padding(vertical = Tokens.Space.s4.dp),
        verticalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp),
    ) {
        if (model.formats.size > 1) ChipRow(model.formats, actions.format, scrolls)
        ChipRow(model.positions, actions.position, scrolls)
    }
}

@Composable
private fun <Value> ChipRow(
    chips: List<BoardChip<Value>>,
    choose: (Value) -> Unit,
    scrolls: Boolean = true,
) {
    // A still row (a snapshot's) runs past the edge as the scrolling one does, never squeezing a chip.
    val scroll =
        if (scrolls) {
            Modifier.fillMaxWidth().horizontalScroll(rememberScrollState())
        } else {
            Modifier.fillMaxWidth().wrapContentWidth(Alignment.Start, unbounded = true)
        }
    Row(
        scroll.padding(horizontal = Tokens.Space.s3.dp),
        horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp),
    ) {
        chips.forEach { chip -> Chip(chip.label, chip.pressed) { choose(chip.value) } }
    }
}

/** A choice chip (ChipGroup.svelte): a capsule, the ink filled when pressed. */
@Composable
private fun Chip(
    label: String,
    pressed: Boolean,
    press: () -> Unit,
) {
    val c = CommishTheme.colors
    val shape = RoundedCornerShape(Tokens.Radius.pill.dp)
    val ground = if (pressed) Modifier.background(c.ink, shape) else Modifier.border(1.dp, c.lineStrong, shape)
    Text(
        label,
        style = Faces.body.copy(fontWeight = FontWeight.Medium),
        color = if (pressed) c.bg else c.ink,
        modifier =
            Modifier
                .then(ground)
                .clickable(role = Role.Tab, onClick = press)
                .semantics { selected = pressed }
                .padding(horizontal = Tokens.Space.s4.dp, vertical = Tokens.Space.s2.dp + 2.dp),
    )
}

/** The basis, said once at the foot: what the numbers are, then the capture the statuses come from. */
@Composable
internal fun BoardBasis(
    lines: List<String>,
    modifier: Modifier = Modifier,
) {
    Column(modifier.padding(horizontal = Tokens.Space.s3.dp), verticalArrangement = Arrangement.spacedBy(Tokens.Space.s1.dp)) {
        lines.forEach { Text(it, style = Faces.small, color = CommishTheme.colors.ink3) }
    }
}

/** The one verb pinned above the bar, where the web's board pins it, on the page's raised shadow. */
@Composable
internal fun BoardPin(
    verb: PageVerb,
    press: () -> Unit,
) {
    Surface(color = CommishTheme.colors.bg, shadowElevation = PIN_SHADOW, modifier = Modifier.fillMaxWidth()) {
        Box(Modifier.padding(horizontal = Tokens.Space.s3.dp, vertical = Tokens.Space.s2.dp)) {
            Verb(verb.title, onClick = press)
        }
    }
}
