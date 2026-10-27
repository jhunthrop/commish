package app.trycommish.feature.mock

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import app.trycommish.core.lobby.LobbyCard
import app.trycommish.design.CommishTheme
import app.trycommish.design.Faces
import app.trycommish.design.NumWeight
import app.trycommish.design.Tokens
import app.trycommish.design.Verb
import app.trycommish.design.Words
import app.trycommish.feature.companion.Edge
import app.trycommish.feature.companion.NoteText
import app.trycommish.feature.companion.Panel

private val CARD_HEIGHT = 44.dp
private const val HANDLE_MIN = 3

/** The open house drafts under the setup (LobbyList.svelte at 390, where the web's /lobby goes): the list's
 * head, its cards and its problem, the handle a join waits on, and what the controls do. */
class LobbySetup(
    val head: String,
    val cards: List<LobbyCard>,
    val problem: String?,
    val enabled: Boolean,
    /** A join waits on a handle: the question shows, with the API's word on the last one tried. */
    val asking: Boolean = false,
    val handleProblem: String? = null,
    val join: (LobbyCard) -> Unit = {},
    /** The quiet "Join a lobby with people" beside the setup's verb: the format nearest the setup's. */
    val joinNearest: () -> Unit = {},
    val saveHandle: (String) -> Unit = {},
    /** The list has been read: before then only the quiet verb shows. */
    val listed: Boolean = true,
)

/** The list (LobbyList.svelte at 390), the iOS LobbyListView's: a card a format with its title and clock, how
 * many are in, and its one verb; a draft the member holds a seat in reads "Your seat" on the accent. */
@Composable
internal fun LobbyListView(lobby: LobbySetup) {
    val c = CommishTheme.colors
    Panel {
        Column(verticalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp)) {
            Text(
                lobby.head,
                style = Faces.body.copy(fontWeight = FontWeight.Bold),
                color = c.ink,
                modifier = Modifier.semantics { heading() },
            )
            lobby.cards.forEach { LobbyCardRow(it, lobby.enabled) { lobby.join(it) } }
            lobby.problem?.let { NoteText(it) }
        }
    }
}

@Composable
private fun LobbyCardRow(
    card: LobbyCard,
    enabled: Boolean,
    join: () -> Unit,
) {
    val c = CommishTheme.colors
    val shape = RoundedCornerShape(Tokens.Radius.md.dp)
    val seated = card.seat != null
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = CARD_HEIGHT)
            .background(if (seated) c.accentWash else c.surface, shape)
            .border(1.dp, if (seated) c.accent else c.line, shape)
            .clickable(enabled = enabled, role = Role.Button, onClick = join)
            .padding(horizontal = Tokens.Space.s3.dp, vertical = Tokens.Space.s2.dp)
            .semantics(mergeDescendants = true) {},
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp),
    ) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(card.title, style = Faces.small.copy(fontWeight = FontWeight.Bold), color = c.ink)
            Text(
                card.clock,
                style = Faces.label.copy(fontWeight = FontWeight.Normal, letterSpacing = Faces.small.letterSpacing),
                color = c.ink3,
            )
        }
        Text(
            card.fill,
            style = if (card.empty) Faces.small.copy(fontWeight = FontWeight.Medium) else Faces.number(NumWeight.Bold),
            color = if (card.empty) c.ink3 else c.ink2,
        )
        Text(card.verb, style = Faces.small.copy(fontWeight = FontWeight.SemiBold), color = c.accentText)
    }
}

/** The handle a join needs first (HandlePrompt.svelte), the iOS LobbyHandleView's: the question, the field, Save
 * and join, and the API's word when it refused the last one. */
@Composable
internal fun LobbyHandleView(lobby: LobbySetup) {
    var handle by rememberSaveable { mutableStateOf("") }
    Panel(Edge.Accent) {
        Column(verticalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp)) {
            Text(Words.Lobby.handleAsk, style = Faces.body.copy(fontWeight = FontWeight.SemiBold), color = CommishTheme.colors.ink)
            OutlinedTextField(
                handle,
                { handle = it },
                Modifier.fillMaxWidth().semantics { contentDescription = Words.Lobby.handleLabel },
                singleLine = true,
                placeholder = { Text(Words.Lobby.handlePlaceholder, style = Faces.small) },
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.None, autoCorrectEnabled = false),
            )
            Verb(Words.Lobby.saveAndJoin, enabled = lobby.enabled && handle.trim().length >= HANDLE_MIN) { lobby.saveHandle(handle) }
            lobby.handleProblem?.let { NoteText(it) }
        }
    }
}
