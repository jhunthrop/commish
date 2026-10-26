package app.trycommish.feature.companion

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.trycommish.core.companion.NewCompanionForm
import app.trycommish.core.companion.NewCompanionViewModel
import app.trycommish.core.companion.RecentDraft
import app.trycommish.core.companion.SeatBy
import app.trycommish.design.CommishTheme
import app.trycommish.design.Faces
import app.trycommish.design.NumWeight
import app.trycommish.design.Tokens
import app.trycommish.design.Verb
import app.trycommish.design.Words
import app.trycommish.feature.boxscore.ChoiceChip

private val FIELD_HEIGHT = 48.dp
private const val SLOTS_A_ROW = 7

/** What the start page's controls do: typing, the seat, following, and a draft followed before. */
class NewCompanionActions(
    val link: (String) -> Unit = {},
    val seat: (SeatBy) -> Unit = {},
    val slot: (Int) -> Unit = {},
    val username: (String) -> Unit = {},
    val follow: () -> Unit = {},
    val open: (String) -> Unit = {},
)

/** The start page as its form says it (NewCompanion.svelte at 390), the approved iOS page's: the title and
 * its line, the Sleeper draft link, the seat by slot (a chip a slot) or by Sleeper username, the one verb
 * with what the API said under it, and the drafts followed before, each a tap back to it. `still` draws the
 * fields at rest (a snapshot's renderer draws a text field's variable fonts at their thinnest). */
@Composable
fun NewCompanionScreen(
    form: NewCompanionForm,
    actions: NewCompanionActions,
    modifier: Modifier = Modifier,
    still: Boolean = false,
) {
    val c = CommishTheme.colors
    Column(modifier.padding(Tokens.Space.s4.dp), verticalArrangement = Arrangement.spacedBy(Tokens.Space.s4.dp)) {
        Column(verticalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp)) {
            Text(
                Words.CompanionNew.title.uppercase(),
                style = Faces.number(NumWeight.Bold, Tokens.Type.display.sp),
                color = c.ink,
                modifier = Modifier.semantics { heading() },
            )
            NoteText(Words.CompanionNew.lede)
        }
        Field(Words.CompanionNew.linkLabel, form.link, Words.CompanionNew.linkPlaceholder, actions.link, actions.follow, still)
        Column(verticalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp)) {
            HeadText(Words.CompanionNew.seatBy, end = false)
            Row(horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp)) {
                ChoiceChip(Words.CompanionNew.bySlot, form.seat == SeatBy.Slot) { actions.seat(SeatBy.Slot) }
                ChoiceChip(Words.CompanionNew.byUsername, form.seat == SeatBy.Username) { actions.seat(SeatBy.Username) }
            }
            if (form.seat == SeatBy.Slot) {
                HeadText(Words.CompanionNew.slotLabel, Modifier.padding(top = Tokens.Space.s1.dp), end = false)
                Slots(form.slot, actions.slot)
            } else {
                Field(Words.CompanionNew.usernameLabel, form.username, null, actions.username, actions.follow, still)
            }
        }
        Column(verticalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp)) {
            Verb(Words.CompanionNew.verb, enabled = form.ready, onClick = actions.follow)
            form.problem?.let { NoteText(it, Modifier.semantics { liveRegion = LiveRegionMode.Polite }, ink = c.lossInk) }
        }
        when {
            form.recentFailed -> NoteText(Words.CompanionNew.recentFailed)
            form.recent.isNotEmpty() -> Recent(form.recent, actions.open)
        }
    }
}

/** A chip a slot, seven to a row, the slot chosen pressed. */
@Composable
private fun Slots(
    chosen: Int,
    choose: (Int) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp)) {
        NewCompanionViewModel.SLOTS.chunked(SLOTS_A_ROW).forEach { row ->
            Row(Modifier.fillMaxWidth()) {
                row.forEach { slot ->
                    Box(Modifier.weight(1f), Alignment.Center) { ChoiceChip(slot.toString(), slot == chosen) { choose(slot) } }
                }
            }
        }
    }
}

/** The drafts followed before (NewCompanion.svelte's list): each its name in the accent and its line. */
@Composable
private fun Recent(
    drafts: List<RecentDraft>,
    open: (String) -> Unit,
) {
    val c = CommishTheme.colors
    Column {
        SectionHead(Words.CompanionNew.recentTitle, modifier = Modifier.padding(bottom = Tokens.Space.s2.dp))
        drafts.forEach { draft ->
            RowRule()
            Column(
                Modifier
                    .fillMaxWidth()
                    .clickable(role = Role.Button, onClickLabel = draft.lead) { open(draft.id) }
                    .padding(vertical = Tokens.Space.s2.dp),
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                Text(draft.lead, style = Faces.body.copy(fontWeight = FontWeight.SemiBold), color = c.accentText)
                NoteText(draft.text, ink = c.ink3)
            }
        }
    }
}

/** A labelled field (Field.svelte): the label, then the line to type in; a link or a username as typed, no
 * capitals, no corrections, the keyboard with the slash. */
@Suppress("LongParameterList") // A field's label, value, prompt, its two verbs and how it draws.
@Composable
private fun Field(
    label: String,
    text: String,
    prompt: String?,
    type: (String) -> Unit,
    submit: () -> Unit,
    still: Boolean,
) {
    val c = CommishTheme.colors
    val shape = RoundedCornerShape(Tokens.Radius.md.dp)
    val frame =
        Modifier
            .fillMaxWidth()
            .heightIn(min = FIELD_HEIGHT)
            .background(c.surface, shape)
            .border(1.dp, c.lineStrong, shape)
            .padding(horizontal = Tokens.Space.s3.dp)
    Column(verticalArrangement = Arrangement.spacedBy(Tokens.Space.s1.dp)) {
        HeadText(label, end = false)
        if (still) {
            Box(frame, contentAlignment = Alignment.CenterStart) {
                Text(text.ifEmpty { prompt.orEmpty() }, style = Faces.body, color = if (text.isEmpty()) c.ink3 else c.ink)
            }
            return@Column
        }
        BasicTextField(
            value = text,
            onValueChange = type,
            singleLine = true,
            textStyle = Faces.body.copy(color = c.ink),
            cursorBrush = SolidColor(c.accent),
            keyboardOptions =
                KeyboardOptions(
                    capitalization = KeyboardCapitalization.None,
                    autoCorrectEnabled = false,
                    keyboardType = KeyboardType.Uri,
                    imeAction = ImeAction.Go,
                ),
            keyboardActions = KeyboardActions(onGo = { submit() }),
            modifier = frame.semantics { contentDescription = label },
            decorationBox = { field ->
                Box(Modifier.fillMaxWidth().heightIn(min = FIELD_HEIGHT), contentAlignment = Alignment.CenterStart) {
                    if (text.isEmpty() && prompt != null) Text(prompt, style = Faces.body, color = c.ink3)
                    field()
                }
            },
        )
    }
}
