package app.trycommish.feature.waivers

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import app.trycommish.core.waivers.WaiverSort
import app.trycommish.core.waivers.WaiverSortKey
import app.trycommish.design.CommishTheme
import app.trycommish.design.Faces
import app.trycommish.design.R
import app.trycommish.design.Tokens
import app.trycommish.design.Words
import app.trycommish.feature.boxscore.HEAD_TRACKING
import app.trycommish.feature.boxscore.Hairline

private val FIELD_HEIGHT = 40.dp
private val HEAD_HEIGHT = 34.dp
private const val UP_TURN = 180f

/** What the table's controls do and where they stand: the position chosen and its chips, the search as
 * typed, why a position could not be read; the sort and what choosing a head does. */
class WaiverControls(
    val query: String,
    val find: (String) -> Unit,
    val problem: String?,
    val sort: WaiverSort,
    val onSort: (WaiverSortKey) -> Unit,
    /** Draws the search at rest, its words as text: a snapshot's renderer draws a text field's variable
     * fonts at their thinnest everywhere on the page. */
    val still: Boolean = false,
)

/** The name search over the table (WaiverScreen.svelte's filters row; the position cards are the screen's
 * navigation, Lane 305), and why a position could not be read. */
@Composable
internal fun Filters(controls: WaiverControls) {
    val c = CommishTheme.colors
    Column(verticalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp)) {
        Search(controls.query, controls.find, controls.still)
        controls.problem?.let { Text(it, style = Faces.small.copy(fontWeight = FontWeight.SemiBold), color = c.lossInk) }
    }
}

/** "Find a player": the rows whose name holds what is typed, any case. */
@Composable
private fun Search(
    query: String,
    find: (String) -> Unit,
    still: Boolean,
) {
    val c = CommishTheme.colors
    val shape = RoundedCornerShape(Tokens.Radius.md.dp)
    if (still) {
        SearchFrame(query) { Text(query, style = Faces.body, color = c.ink) }
        return
    }
    BasicTextField(
        value = query,
        onValueChange = find,
        singleLine = true,
        textStyle = Faces.body.copy(color = c.ink),
        cursorBrush = SolidColor(c.accent),
        keyboardOptions =
            KeyboardOptions(
                capitalization = KeyboardCapitalization.None,
                autoCorrectEnabled = false,
                imeAction = ImeAction.Search,
            ),
        modifier =
            Modifier
                .fillMaxWidth()
                .height(FIELD_HEIGHT)
                .background(c.surface, shape)
                .border(1.dp, c.lineStrong, shape)
                .semantics { contentDescription = Words.Waivers.find },
        decorationBox = { field -> SearchInside(query, field) },
    )
}

/** The search's frame drawn at rest, for a snapshot. */
@Composable
private fun SearchFrame(
    query: String,
    field: @Composable () -> Unit,
) {
    val c = CommishTheme.colors
    val shape = RoundedCornerShape(Tokens.Radius.md.dp)
    Box(
        Modifier
            .fillMaxWidth()
            .height(FIELD_HEIGHT)
            .background(c.surface, shape)
            .border(1.dp, c.lineStrong, shape),
        contentAlignment = Alignment.CenterStart,
    ) { SearchInside(query, field) }
}

/** The glass, then the words typed or what the field is for. */
@Composable
private fun SearchInside(
    query: String,
    field: @Composable () -> Unit,
) {
    val c = CommishTheme.colors
    Row(
        Modifier.padding(horizontal = Tokens.Space.s3.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp),
    ) {
        Icon(painterResource(R.drawable.icon_search), null, Modifier.size(16.dp), tint = c.ink3)
        Box(Modifier.weight(1f)) {
            if (query.isEmpty()) Text(Words.Waivers.find, style = Faces.body, color = c.ink3)
            field()
        }
    }
}

/** The heads: Player, Proj (once the week's projection is read), Beats, each a button that sorts the
 * table by it (WaiverTable.svelte's sort buttons); the sorted head is in the ink with its caret, up when
 * lowest first. */
@Composable
internal fun WaiverHeadRow(
    projected: Boolean,
    sort: WaiverSort,
    onSort: (WaiverSortKey) -> Unit,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = HEAD_HEIGHT)
            .background(CommishTheme.colors.bg)
            .padding(horizontal = Tokens.Space.s2.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        SortHead(Words.Box.player, WaiverSortKey.Name, sort, onSort, Modifier.weight(1f), Alignment.Start)
        if (projected) SortHead(Words.Box.proj, WaiverSortKey.Proj, sort, onSort, Modifier.width(WaiverColumn.proj), Alignment.End)
        SortHead(Words.Waivers.beats, WaiverSortKey.Beats, sort, onSort, Modifier.width(WaiverColumn.beats), Alignment.End)
        Spacer(Modifier.width(WaiverColumn.act))
    }
    Hairline()
}

@Composable
private fun SortHead(
    words: String,
    key: WaiverSortKey,
    sort: WaiverSort,
    onSort: (WaiverSortKey) -> Unit,
    modifier: Modifier,
    align: Alignment.Horizontal,
) {
    val c = CommishTheme.colors
    val lit = sort.key == key
    Box(modifier, contentAlignment = if (align == Alignment.End) Alignment.CenterEnd else Alignment.CenterStart) {
        Row(
            Modifier
                .heightIn(min = HEAD_HEIGHT)
                .clickable(role = Role.Button) { onSort(key) }
                .semantics {
                    contentDescription = words
                    stateDescription =
                        if (!lit) {
                            ""
                        } else if (sort.down) {
                            "descending"
                        } else {
                            "ascending"
                        }
                },
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(3.dp),
        ) {
            Text(
                words.uppercase(),
                style = Faces.label.copy(letterSpacing = HEAD_TRACKING.em),
                color = if (lit) c.ink else c.ink3,
                textAlign = if (align == Alignment.End) TextAlign.End else TextAlign.Start,
            )
            if (lit) Caret(sort.down, 12.dp)
        }
    }
}

/** The sorted head's caret: down when highest first, up when lowest first. */
@Composable
private fun Caret(
    down: Boolean,
    side: Dp,
) {
    Icon(
        painterResource(R.drawable.icon_chevron),
        contentDescription = null,
        tint = CommishTheme.colors.accentText,
        modifier = Modifier.size(side).rotate(if (down) 0f else UP_TURN),
    )
}
