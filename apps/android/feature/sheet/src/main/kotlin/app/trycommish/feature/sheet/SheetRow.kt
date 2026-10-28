package app.trycommish.feature.sheet

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import app.trycommish.core.sheet.RowSave
import app.trycommish.core.sheet.SheetLimits
import app.trycommish.core.sheet.SheetLine
import app.trycommish.core.sheet.SheetModel
import app.trycommish.core.sheet.SheetWords
import app.trycommish.core.sheet.TagTone
import app.trycommish.core.shell.SheetPlayer
import app.trycommish.design.CommishTheme
import app.trycommish.design.Faces
import app.trycommish.design.Headshot
import app.trycommish.design.NumWeight
import app.trycommish.design.PositionPill
import app.trycommish.design.QuietButton
import app.trycommish.design.R
import app.trycommish.design.TierChip
import app.trycommish.design.Tokens
import app.trycommish.feature.boxscore.ChoiceChip
import app.trycommish.feature.boxscore.Hairline

/** What a row's controls do: his face and name open the player sheet, the disclosure opens his editor, the
 * editor writes his note, his tags and his removal, and an unsaved row's retry writes again. A verb that
 * answers (a tag on a full row, an own tag that cannot be) answers with the sentence to show, or null. */
class SheetRowActions(
    val open: (SheetPlayer) -> Unit = {},
    val toggle: (String) -> Unit = {},
    val note: (String, String) -> Unit = { _, _ -> },
    val tag: (String, String) -> Boolean = { _, _ -> true },
    val addTag: (String, String) -> String? = { _, _ -> null },
    val remove: (String) -> Unit = {},
    val retry: () -> Unit = {},
)

private val FACE = 40.dp
private val ROW_HEIGHT = 56.dp
private val ROW_VERTICAL = 6.dp
private val MARK_HEIGHT = 20.dp
private val TAG_GLYPH = 10.dp
private val NOTE_GLYPH = 14.dp
private val CHEVRON = 14.dp
private val PLACE_WIDTH = 56.dp
private val PLACE_HEIGHT = 44.dp
private const val OPEN_TURN = 180f
private const val CLUB_TRACKING = 0.06

/** The quieter rows under a row line up with his name, past his face. */
private val UNDER_START = (Tokens.Space.s3 + Tokens.Space.s2).dp + FACE

/**
 * One player's row at 390 (SheetRow.svelte's compact row, the iOS SheetRowView): his face, his name the
 * biggest thing with his marks beside it (a count of his tags in their tone, a mark for his note), his
 * position, tier and club under it, his place on the sheet with the editor's disclosure; under the row, an
 * edit not saved said with its reason and a retry, and what the account's copy won.
 */
@Composable
internal fun SheetRowView(
    line: SheetLine,
    open: Boolean,
    actions: SheetRowActions,
    editable: Boolean = true,
    /** A retry is on its way: Try again is held, so a second tap sends nothing. */
    retrying: Boolean = false,
) {
    val c = CommishTheme.colors
    Column(Modifier.fillMaxWidth().background(if (open) c.surface2 else c.surface)) {
        Row(
            Modifier.fillMaxWidth().heightIn(min = ROW_HEIGHT).padding(horizontal = Tokens.Space.s3.dp, vertical = ROW_VERTICAL),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp),
        ) {
            Who(line, Modifier.weight(1f).clickable(role = Role.Button, onClickLabel = line.name) { actions.open(line.player) })
            Place(line, open, editable) { actions.toggle(line.id) }
        }
        line.save.words?.let { SaveLine(it, line.save is RowSave.Unsaved, retrying, actions.retry) }
        line.notices.forEach { Under(it, c.ink3) }
        Hairline()
    }
}

/** His face, his name with his marks, and his position, tier and club. */
@Composable
private fun Who(
    line: SheetLine,
    modifier: Modifier,
) {
    val c = CommishTheme.colors
    Row(modifier, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp)) {
        Headshot(line.headshot, line.initials, FACE, club = line.team.takeIf { line.clubMark })
        Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(
                    line.name,
                    style = Faces.body.copy(fontWeight = FontWeight.SemiBold),
                    color = c.ink,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f, fill = false),
                )
                Marks(line)
            }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                PositionPill(line.position)
                line.tier?.let { TierChip(it) }
                line.team?.takeUnless { line.clubMark }?.let {
                    Text(it, style = Faces.label.copy(letterSpacing = CLUB_TRACKING.em), color = c.ink3)
                }
            }
        }
    }
}

/** His tags folded into a count in their tone (Avoid's loss tone over the rest) and a mark for a note. */
@Composable
private fun Marks(line: SheetLine) {
    val c = CommishTheme.colors
    if (line.tags.isNotEmpty()) {
        val avoids = line.tags.any { it.tone == TagTone.Loss }
        val ink = if (avoids) c.lossInk else c.accentText
        Row(
            Modifier
                .height(MARK_HEIGHT)
                .background(if (avoids) c.lossBg else c.surface2, RoundedCornerShape(Tokens.Radius.pill.dp))
                .padding(horizontal = 6.dp)
                .semantics(mergeDescendants = true) { contentDescription = SheetWords.tagsSaid(line.tags) },
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(3.dp),
        ) {
            Icon(painterResource(R.drawable.icon_tag), null, Modifier.size(TAG_GLYPH), tint = ink)
            Text(line.tags.size.toString(), style = Faces.label.copy(fontWeight = FontWeight.Bold), color = ink)
        }
    }
    if (line.note != null) {
        Icon(painterResource(R.drawable.icon_note), SheetWords.hasNote, Modifier.size(NOTE_GLYPH), tint = c.ink3)
    }
}

/** His place on the sheet and the editor's disclosure; a preview row draws the place alone. */
@Composable
private fun Place(
    line: SheetLine,
    open: Boolean,
    editable: Boolean,
    toggle: () -> Unit,
) {
    val c = CommishTheme.colors
    val figure = Faces.number(NumWeight.Bold, Tokens.Type.xl.sp)
    if (!editable) {
        Text(line.place.toString(), style = figure, color = c.ink2)
        return
    }
    Row(
        Modifier
            .widthIn(min = PLACE_WIDTH)
            .heightIn(min = PLACE_HEIGHT)
            .clickable(role = Role.Button, onClickLabel = SheetWords.edit(line.name), onClick = toggle)
            .semantics(mergeDescendants = true) { contentDescription = SheetWords.edit(line.name) },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp, Alignment.End),
    ) {
        Text(line.place.toString(), style = figure, color = c.ink2)
        Icon(painterResource(R.drawable.icon_chevron), null, Modifier.size(CHEVRON).rotate(if (open) OPEN_TURN else 0f), tint = c.ink3)
    }
}

/** The row's save: on its way, or not saved with the reason and the retry. */
@Composable
private fun SaveLine(
    words: String,
    unsaved: Boolean,
    retrying: Boolean,
    retry: () -> Unit,
) {
    val c = CommishTheme.colors
    Row(
        Modifier.fillMaxWidth().padding(start = UNDER_START, end = Tokens.Space.s3.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp),
    ) {
        Text(words, style = underStyle(), color = if (unsaved) c.lossInk else c.ink3, modifier = Modifier.weight(1f))
        if (unsaved) QuietButton(SheetWords.tryAgain, enabled = !retrying, onClick = retry)
    }
}

/** A quiet sentence under the row (what the account's copy won), lined up with his name. */
@Composable
private fun Under(
    words: String,
    color: Color,
) {
    Text(
        words,
        style = underStyle(),
        color = color,
        modifier = Modifier.fillMaxWidth().padding(start = UNDER_START, end = Tokens.Space.s3.dp, bottom = Tokens.Space.s1.dp),
    )
}

private fun underStyle(): TextStyle = Faces.small.copy(fontSize = Tokens.Type.xs.sp, fontWeight = FontWeight.SemiBold)

/**
 * The open row's editor (RowEditor.svelte, the iOS SheetEditorView): his note, the fixed tags and the
 * drafter's own as chips, a field for a tag of his own, and taking him off the sheet. The note is written
 * when its field lets go of the keyboard or the editor closes. `live` false draws the note as it reads.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun SheetEditor(
    line: SheetLine,
    ownTags: List<String>,
    actions: SheetRowActions,
    live: Boolean = true,
) {
    val c = CommishTheme.colors
    var problem by remember(line.id) { mutableStateOf<String?>(null) }
    var newTag by remember(line.id) { mutableStateOf("") }
    val addOwn = {
        problem = actions.addTag(line.id, newTag)
        if (problem == null) newTag = ""
    }
    Column(
        Modifier.fillMaxWidth().background(c.surface2).padding(Tokens.Space.s3.dp),
        verticalArrangement = Arrangement.spacedBy(Tokens.Space.s3.dp),
    ) {
        NoteField(line, live) { actions.note(line.id, it) }
        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp),
            verticalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp),
        ) {
            SheetModel.tagChips(line, ownTags).forEach { chip ->
                ChoiceChip(chip.label, chip.pressed) { problem = if (actions.tag(line.id, chip.value)) null else SheetWords.full }
            }
        }
        if (line.tagged.size < SheetLimits.TAGS) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp)) {
                SheetField(newTag, SheetWords.ownTagPlaceholder, live, Modifier.weight(1f), onDone = addOwn) { newTag = it }
                QuietButton(SheetWords.addTag, onClick = addOwn)
            }
        }
        problem?.let { Text(it, style = Faces.small.copy(fontWeight = FontWeight.Medium), color = c.lossInk) }
        QuietButton(SheetWords.remove) { actions.remove(line.id) }
    }
    Hairline()
}

/** His note: typed in place, and written when the field lets go of the keyboard or the editor closes only
 * where the member typed something other than what the field holds from the account (NoteDraft); while the
 * field is not being typed in it follows the account's note, so a refresh, a retry's merge or an import under
 * it is never written back. */
@Composable
private fun NoteField(
    line: SheetLine,
    live: Boolean,
    write: (String) -> Unit,
) {
    var draft by remember(line.id) { mutableStateOf(NoteDraft.opened(line.note)) }
    LaunchedEffect(line.note) { draft = draft.follow(line.note) }
    val latest by rememberUpdatedState(draft)
    val writeNow by rememberUpdatedState(write)
    if (live) {
        DisposableEffect(line.id) { onDispose { latest.commit().second?.let(writeNow) } }
    }
    SheetField(
        draft.text,
        SheetWords.notePlaceholder,
        live,
        Modifier.fillMaxWidth(),
        lines = NOTE_LINES,
        focusChanged = { focused ->
            if (focused) {
                draft = draft.focus(true)
            } else {
                val (next, typed) = draft.focus(false).commit()
                draft = if (typed == null) next.follow(line.note) else next
                typed?.let(write)
            }
        },
    ) { draft = draft.typed(it) }
}

private val NOTE_LINES = 2..4

/** A text field in the sheet's frame (Field.svelte): the surface, a hairline border, the body face; what is
 * typed or what the field is for. `live` false draws it at rest, its words as text (a snapshot's renderer
 * draws a text field's variable fonts at their thinnest). */
@Composable
internal fun SheetField(
    value: String,
    placeholder: String,
    live: Boolean,
    modifier: Modifier = Modifier,
    lines: IntRange = 1..1,
    style: TextStyle = Faces.body,
    focusChanged: (Boolean) -> Unit = {},
    onDone: () -> Unit = {},
    change: (String) -> Unit,
) {
    val c = CommishTheme.colors
    val shape = RoundedCornerShape(Tokens.Radius.sm.dp)
    val frame =
        modifier
            .background(c.surface, shape)
            .border(1.dp, c.line, shape)
            .padding(Tokens.Space.s2.dp)
    val single = lines.last == 1
    val shown: @Composable () -> Unit = {
        if (value.isEmpty()) Text(placeholder, style = style, color = c.ink3, maxLines = lines.last, minLines = lines.first)
    }
    if (!live) {
        Box(frame) {
            if (value.isEmpty()) shown() else Text(value, style = style, color = c.ink, maxLines = lines.last, minLines = lines.first)
        }
        return
    }
    var focused by remember { mutableStateOf(false) }
    BasicTextField(
        value = value,
        onValueChange = change,
        singleLine = single,
        minLines = lines.first,
        maxLines = lines.last,
        textStyle = style.copy(color = c.ink),
        cursorBrush = SolidColor(c.accent),
        keyboardOptions = KeyboardOptions(autoCorrectEnabled = false, imeAction = if (single) ImeAction.Done else ImeAction.Default),
        keyboardActions = KeyboardActions(onDone = { onDone() }),
        modifier =
            frame
                .semantics { contentDescription = placeholder }
                .onFocusChanged { state ->
                    if (focused != state.isFocused) focusChanged(state.isFocused)
                    focused = state.isFocused
                },
        decorationBox = { field ->
            Box {
                shown()
                field()
            }
        },
    )
}
