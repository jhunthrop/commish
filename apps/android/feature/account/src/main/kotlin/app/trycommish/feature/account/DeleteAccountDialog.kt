package app.trycommish.feature.account

import android.view.WindowManager
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogWindowProvider
import app.trycommish.core.account.DeletionUi
import app.trycommish.design.CommishTheme
import app.trycommish.design.Faces
import app.trycommish.design.Tokens
import app.trycommish.design.Verb
import app.trycommish.design.Words

private val FIELD_HEIGHT = 48.dp
private val DOT = 4.dp

/** The Account's Delete account dialog: the panel over the screen, put away by Back or a tap outside unless
 * the delete is under way. The panel scrolls above the keyboard, and the keyboard's Done puts it away, so
 * the verb is in reach once the email is typed. */
@Composable
fun DeleteAccountDialog(
    ui: DeletionUi,
    type: (String) -> Unit,
    delete: () -> Unit,
    close: () -> Unit,
) {
    Dialog(onDismissRequest = close) {
        // The dialog's window gives way to the keyboard, so the panel's scroll reaches the verb under it.
        val window = (LocalView.current.parent as? DialogWindowProvider)?.window
        SideEffect {
            @Suppress("DEPRECATION") // adjustResize is still how a dialog's window gives way to the keyboard.
            window?.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
        }
        DeleteAccountPanel(ui, type, delete, Modifier.verticalScroll(rememberScrollState()))
    }
}

/**
 * The confirmation (DeleteView.svelte, in the web's words, the iOS DeleteAccountSheet's twin): what is
 * deleted and what is kept, who is signed in, the email typed by hand, and the one verb, held until the
 * email is the account's and while the delete runs; a refusal in the API's sentence under it. `still` draws
 * the field's text in place of the live field, for a snapshot.
 */
@Composable
fun DeleteAccountPanel(
    ui: DeletionUi,
    type: (String) -> Unit,
    delete: () -> Unit,
    modifier: Modifier = Modifier,
    still: Boolean = false,
) {
    val c = CommishTheme.colors
    val words = Words.DeleteAccount
    Column(
        modifier
            .background(c.bg, RoundedCornerShape(Tokens.Radius.md.dp))
            .fillMaxWidth()
            .padding(Tokens.Space.s5.dp),
        verticalArrangement = Arrangement.spacedBy(Tokens.Space.s5.dp),
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp)) {
            Text(words.heading, style = Faces.head, color = c.ink, modifier = Modifier.semantics { heading() })
            Text(words.lead, style = Faces.body, color = c.ink2)
        }
        DeleteList(words.deletedHead, words.deleted)
        DeleteList(words.keptHead, words.kept)
        Column(verticalArrangement = Arrangement.spacedBy(Tokens.Space.s3.dp)) {
            Text(ui.signedIn, style = Faces.small, color = c.ink3)
            EmailField(ui, type, still)
            Verb(words.sheetVerb, Modifier.fillMaxWidth(), enabled = ui.canDelete, onClick = delete)
            ui.problem?.let { ProblemText(it) }
        }
    }
}

/** One of the two lists, Deleted or Kept: its head, then its lines. */
@Composable
private fun DeleteList(
    head: String,
    lines: List<String>,
) {
    val c = CommishTheme.colors
    Column(verticalArrangement = Arrangement.spacedBy(Tokens.Space.s1.dp)) {
        Text(
            head.uppercase(),
            style = Faces.small.copy(fontWeight = FontWeight.Bold),
            color = c.ink3,
            modifier = Modifier.semantics { heading() },
        )
        lines.forEach { line ->
            Row(horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp)) {
                // The dot sits on the first line, its own height above the baseline (the iOS list's).
                Box(Modifier.alignBy { it.measuredHeight * 2 }.size(DOT).background(c.ink3, CircleShape))
                Text(line, style = Faces.body, color = c.ink2, modifier = Modifier.alignByBaseline())
            }
        }
    }
}

/** The labelled field (Field.svelte): the label, then the line the email is typed in. */
@Composable
private fun EmailField(
    ui: DeletionUi,
    type: (String) -> Unit,
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
        Text(Words.DeleteAccount.confirm, style = Faces.small.copy(fontWeight = FontWeight.SemiBold), color = c.ink2)
        if (still) {
            Box(frame, contentAlignment = Alignment.CenterStart) { Text(ui.typed, style = Faces.body, color = c.ink) }
            return@Column
        }
        val focus = LocalFocusManager.current
        BasicTextField(
            value = ui.typed,
            onValueChange = type,
            enabled = !ui.busy,
            singleLine = true,
            textStyle = Faces.body.copy(color = c.ink),
            cursorBrush = SolidColor(c.accent),
            keyboardOptions =
                KeyboardOptions(
                    capitalization = KeyboardCapitalization.None,
                    autoCorrectEnabled = false,
                    keyboardType = KeyboardType.Email,
                    imeAction = ImeAction.Done,
                ),
            keyboardActions = KeyboardActions(onDone = { focus.clearFocus() }),
            modifier = frame.semantics { contentDescription = Words.DeleteAccount.confirm },
            decorationBox = { field ->
                Box(Modifier.fillMaxWidth().heightIn(min = FIELD_HEIGHT), contentAlignment = Alignment.CenterStart) { field() }
            },
        )
    }
}
