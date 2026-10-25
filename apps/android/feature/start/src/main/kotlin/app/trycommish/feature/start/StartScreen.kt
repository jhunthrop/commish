package app.trycommish.feature.start

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import app.trycommish.core.AppWords
import app.trycommish.core.shell.SheetPlayer
import app.trycommish.core.start.StartModel
import app.trycommish.core.start.StartPin
import app.trycommish.core.start.StartState
import app.trycommish.core.start.StartUi
import app.trycommish.design.CommishTheme
import app.trycommish.design.Faces
import app.trycommish.design.Mark
import app.trycommish.design.QuietButton
import app.trycommish.design.Tokens

/** What the screen's controls do: a row's name opens the player sheet by his id, the chevron its
 * evidence line, a link its page; the pin's verb, confirmation and way out; a pull reads again. */
class StartActions(
    val open: (SheetPlayer) -> Unit = {},
    val toggleWhy: (String) -> Unit = {},
    val openRecord: () -> Unit = {},
    val refresh: () -> Unit = {},
    val pin: PinActions = PinActions(),
)

/** The screen's two runs, top to bottom: the strip with the lineup and its Team row, then the bench, the
 * injured reserve and the basis. Each is a snapshot of its own, so no reference grows past what a
 * repository keeps. */
enum class StartPart { Lineup, Bench }

/**
 * The Start screen (web StartScreen.svelte at 390): the strip, the lineup with the Team row, the bench
 * and the injured reserve, the basis once at the foot, in the web's order, and the one verb pinned above
 * the bar. Pull down to read again. The screen decides nothing: the state, the stamp and the pin are the
 * view model's.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun StartScreen(
    ui: StartUi,
    stamp: String?,
    pin: StartPin,
    refreshing: Boolean,
    actions: StartActions,
    modifier: Modifier = Modifier,
) {
    Column(modifier.fillMaxSize().background(CommishTheme.colors.bg)) {
        PullToRefreshBox(isRefreshing = refreshing, onRefresh = actions.refresh, modifier = Modifier.weight(1f).fillMaxWidth()) {
            when (val state = ui.state) {
                StartState.Loading -> Box(Modifier.fillMaxSize(), Alignment.Center) { CircularProgressIndicator() }
                is StartState.Failed -> Failed(state.message, actions.refresh)
                StartState.SignedOut -> Failed(AppWords.signedOut, null)
                is StartState.Loaded ->
                    StartPage(
                        state.model,
                        stamp,
                        RowActions(actions.open, actions.toggleWhy, ui.opened),
                        actions.openRecord,
                        StartPart.entries,
                        Modifier.fillMaxSize().verticalScroll(rememberScrollState()),
                    )
            }
        }
        if (!pin.isEmpty) Pin(pin, actions.pin)
    }
}

/** The page's runs at their full height: the screen scrolls them, a snapshot draws each whole. */
@Composable
internal fun StartPage(
    model: StartModel,
    stamp: String?,
    actions: RowActions,
    openRecord: () -> Unit,
    parts: List<StartPart>,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier.background(CommishTheme.colors.bg).padding(horizontal = Tokens.Space.s3.dp, vertical = Tokens.Space.s4.dp),
        verticalArrangement = Arrangement.spacedBy(Tokens.Space.s4.dp),
    ) {
        parts.forEach { part ->
            when (part) {
                StartPart.Lineup -> {
                    Strip(model, stamp, openRecord)
                    LineupTable(model, actions)
                }
                StartPart.Bench -> {
                    BenchTable(model, actions)
                    BasisLine(model.basis)
                }
            }
        }
    }
}

/** What the numbers are, said once under the rows, in the interface's face at the box score's size (the
 * reading face reads as a document in season). */
@Composable
private fun BasisLine(text: String) {
    Text(
        text,
        style = Faces.label.copy(fontWeight = Faces.small.fontWeight, letterSpacing = Faces.small.letterSpacing),
        color = CommishTheme.colors.ink3,
    )
}

@Composable
private fun Failed(
    message: String,
    retry: (() -> Unit)?,
) {
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(Tokens.Space.s5.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Mark(size = 48.dp)
        Spacer(Modifier.height(Tokens.Space.s4.dp))
        Text(message, style = Faces.body, color = CommishTheme.colors.ink2, textAlign = TextAlign.Center)
        retry?.let { QuietButton(AppWords.tryAgain, onClick = it) }
    }
}
