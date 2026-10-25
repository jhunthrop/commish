package app.trycommish.feature.boxscore

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.wrapContentWidth
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.trycommish.design.CommishTheme
import app.trycommish.design.Faces
import app.trycommish.design.R
import app.trycommish.design.Tokens

/** Tokens.Type.display over Tokens.Type.head: a page title's size in the head's face. */
private const val DISPLAY_SCALE = Tokens.Type.display / Tokens.Type.head
private val FIELD_HEIGHT = 44.dp

/** A page's head (web PageHead at 390), the run pages' (Rankings, Our record): the name in the number
 * face, the sentence under it, and over a saved read when it was read. */
@Composable
fun PageHead(
    name: String,
    lead: String?,
    stamp: String?,
    modifier: Modifier = Modifier,
) {
    val c = CommishTheme.colors
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(
            name.uppercase(),
            style = Faces.head.copy(fontSize = Faces.head.fontSize * DISPLAY_SCALE),
            color = c.ink,
            modifier = Modifier.semantics { heading() },
        )
        lead?.let { Text(it, style = Faces.small.copy(fontWeight = FontWeight.Medium), color = c.ink2) }
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

/** A choice chip (ChipGroup.svelte, the iOS ChoiceChip): a capsule, the ink filled when pressed. */
@Composable
fun ChoiceChip(
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
        maxLines = 1,
        modifier =
            Modifier
                .then(ground)
                .clickable(role = Role.Tab, onClick = press)
                .semantics { selected = pressed }
                .padding(horizontal = Tokens.Space.s4.dp, vertical = Tokens.Space.s2.dp + 2.dp),
    )
}

/** One row of choice chips that scrolls sideways, or (a snapshot's) lies still running past the edge as
 * the scrolling one does, never squeezing a chip. */
@Composable
fun <Value> ChipRow(
    chips: List<Pair<String, Value>>,
    pressed: Value,
    choose: (Value) -> Unit,
    still: Boolean = false,
    label: String? = null,
) {
    val scroll =
        if (still) {
            Modifier.fillMaxWidth().wrapContentWidth(Alignment.Start, unbounded = true)
        } else {
            Modifier.fillMaxWidth().horizontalScroll(rememberScrollState())
        }
    Row(
        scroll.semantics { label?.let { contentDescription = it } },
        horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp),
    ) {
        chips.forEach { (words, value) -> ChoiceChip(words, value == pressed) { choose(value) } }
    }
}

/** The search, big, with the hits beside it (OrderScreen.svelte's players mode at 390): what is typed, or
 * what the field is for. `still` draws it at rest, its words as text (a snapshot's renderer draws a text
 * field's variable fonts at their thinnest). */
@Composable
fun SearchField(
    query: String,
    placeholder: String,
    hits: String?,
    find: (String) -> Unit,
    still: Boolean = false,
) {
    val c = CommishTheme.colors
    val shape = RoundedCornerShape(Tokens.Radius.md.dp)
    val frame =
        Modifier
            .fillMaxWidth()
            .height(FIELD_HEIGHT)
            .background(c.surface, shape)
            .border(1.dp, c.lineStrong, shape)
    val inside: @Composable (@Composable () -> Unit) -> Unit = { field ->
        Row(
            Modifier.padding(horizontal = Tokens.Space.s3.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp),
        ) {
            Icon(painterResource(R.drawable.icon_search), null, Modifier.size(16.dp), tint = c.ink3)
            Box(Modifier.weight(1f)) {
                if (query.isEmpty()) Text(placeholder, style = Faces.body, color = c.ink3, maxLines = 1, overflow = TextOverflow.Ellipsis)
                field()
            }
            hits?.let { Text(it, style = Faces.small, color = c.ink3, maxLines = 1) }
        }
    }
    if (still) {
        Box(frame, contentAlignment = Alignment.CenterStart) { inside { Text(query, style = Faces.body, color = c.ink) } }
        return
    }
    BasicTextField(
        value = query,
        onValueChange = find,
        singleLine = true,
        textStyle = Faces.body.copy(color = c.ink),
        cursorBrush = SolidColor(c.accent),
        keyboardOptions =
            KeyboardOptions(capitalization = KeyboardCapitalization.None, autoCorrectEnabled = false, imeAction = ImeAction.Search),
        modifier = frame.semantics { contentDescription = placeholder },
        decorationBox = { field -> Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.CenterStart) { inside(field) } },
    )
}

/** The one line over the rows when a chip or search asked for could not be read, in the loss's ink. */
@Composable
fun ProblemLine(problem: String?) {
    problem?.let { Text(it, style = Faces.small.copy(fontWeight = FontWeight.SemiBold), color = CommishTheme.colors.lossInk) }
}
