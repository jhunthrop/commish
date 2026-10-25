package app.trycommish.feature.player

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.trycommish.core.player.PlayerSheetViewModel
import app.trycommish.core.player.PlayerSheets
import app.trycommish.core.player.SheetState
import app.trycommish.core.shell.PlayerSheetHost
import app.trycommish.core.shell.SheetOffer
import app.trycommish.core.shell.SheetVerb
import app.trycommish.core.shell.ShellRoute
import app.trycommish.core.shell.unreadBasis
import app.trycommish.core.start.GameRead
import app.trycommish.design.CommishTheme
import app.trycommish.design.Faces
import app.trycommish.design.Tokens
import app.trycommish.design.Verb
import app.trycommish.design.Words
import app.trycommish.feature.shell.PlayerSheet

/** The verb's room at the sheet's foot. */
private const val HELD_HEIGHT = 48

/**
 * The one player sheet over the tabs (Lane 179's frame, PlayerSheet): its body for the player the host
 * shows and the screen's verb pinned at its foot, both over the one view model `sheets` keeps for his id
 * (plan Review Focus 3), so the list under the sheet reading again (his fresh facts, a new order) neither
 * makes another view model nor reads his week again. Full page opens his page and closes the sheet.
 */
@Composable
fun PlayerSheetContainer(
    host: PlayerSheetHost,
    sheets: PlayerSheets,
    openPlayer: (ShellRoute.Player) -> Unit,
) {
    PlayerSheet(
        host,
        openPlayer,
        foot = { player, close -> PlayerSheetFoot(sheets.of(player), host.offer, close) },
    ) { player ->
        PlayerSheetBody(sheets.of(player))
    }
}

/** The sheet's body over his view model, read once per view model: the shelf's words while his week is
 * read, his card once it is, the shelf's words for a week that could not be read. */
@Composable
fun PlayerSheetBody(viewModel: PlayerSheetViewModel) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    LaunchedEffect(viewModel) { viewModel.load() }
    PlayerSheetState(state, viewModel.stampWords(state))
}

/** The screen's verb at the sheet's foot, in its place once his game has kicked off on a lineup screen the
 * held words (shelf.ts shelfVerb); the verb acts, then the sheet closes. */
@Composable
fun PlayerSheetFoot(
    viewModel: PlayerSheetViewModel,
    offer: SheetOffer?,
    close: () -> Unit,
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    SheetVerb.of(offer, gameOf(state))?.let { verb ->
        SheetVerbView(verb) {
            offer?.act?.invoke()
            close()
        }
    }
}

/** His game by his week's line once his card is read; before, the offer stands. */
fun gameOf(state: SheetState): GameRead? = (state as? SheetState.Loaded)?.card?.game

/** The body at a state, as the mock draws it too. */
@Composable
fun PlayerSheetState(
    state: SheetState,
    stamp: String?,
    modifier: Modifier = Modifier,
) {
    Box(modifier) {
        when (state) {
            SheetState.Loading -> BasisLines(listOf(unreadBasis(failed = false, weekTile = Words.Card.proj)))
            is SheetState.Loaded -> PlayerCardView(state.card, stamp)
            is SheetState.Failed -> BasisLines(listOf(state.words))
        }
    }
}

/** The sheet's verb at its foot (PlayerShelf.svelte's foot): the screen's verb with the line under it, or
 * the held words in its place. */
@Composable
fun SheetVerbView(
    verb: SheetVerb,
    action: () -> Unit,
) {
    val c = CommishTheme.colors
    Column(
        Modifier.fillMaxWidth().background(c.bg),
        verticalArrangement = Arrangement.spacedBy(Tokens.Space.s1.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        HorizontalDivider(color = c.line)
        when (verb) {
            is SheetVerb.Act -> {
                Verb(verb.label, Modifier.padding(top = Tokens.Space.s2.dp), onClick = action)
                verb.line?.let { Text(it, style = Faces.label, color = c.ink3, textAlign = TextAlign.Center) }
            }
            is SheetVerb.Held ->
                Box(Modifier.fillMaxWidth().heightIn(min = HELD_HEIGHT.dp), contentAlignment = Alignment.Center) {
                    Text(verb.words, style = Faces.small, color = c.ink2)
                }
        }
    }
}
