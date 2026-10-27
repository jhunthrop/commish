package app.trycommish.feature.mock

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import app.trycommish.api.models.Lineup
import app.trycommish.api.models.ScoringPreset
import app.trycommish.core.board.BoardChip
import app.trycommish.core.mock.MockSetupForm
import app.trycommish.design.CommishTheme
import app.trycommish.design.Faces
import app.trycommish.design.QuietButton
import app.trycommish.design.Tokens
import app.trycommish.design.Verb
import app.trycommish.design.Words
import app.trycommish.feature.boxscore.ChipRow
import app.trycommish.feature.boxscore.ChoiceChip
import app.trycommish.feature.companion.HeadText
import app.trycommish.feature.companion.NoteText

/** What the setup's controls do: a chip chosen, and the one verb. */
class MockSetupActions(
    val scoring: (ScoringPreset) -> Unit = {},
    val teams: (Int) -> Unit = {},
    val slot: (Int?) -> Unit = {},
    val lineup: (Lineup) -> Unit = {},
    val start: () -> Unit = {},
)

/**
 * The setup (web/src/routes/mock/new at 390) for a mock against bots, the approved iOS screen's: the title,
 * the clocks, the scoring, the teams, your slot, the lineup, and the one verb pinned at the foot. `still` lays
 * the chip rows at rest (a snapshot's). `lobby` draws the open house drafts under the form and the quiet "Join a
 * lobby with people" beside the verb, as the web's setup does; a join that asks for a handle draws its question
 * at the top and scrolls to it.
 */
@Composable
fun MockSetupScreen(
    form: MockSetupForm,
    actions: MockSetupActions,
    modifier: Modifier = Modifier,
    still: Boolean = false,
    lobby: LobbySetup? = null,
) {
    val c = CommishTheme.colors
    val state = rememberScrollState()
    // Keyed on the format asked for, so a second card tapped while the question shows scrolls to it again.
    LaunchedEffect(lobby?.askingFor) { if (lobby?.asking == true) state.animateScrollTo(0) }
    Column(modifier.background(c.bg)) {
        val scroll = if (still) Modifier else Modifier.weight(1f).verticalScroll(state)
        Column(
            scroll.fillMaxWidth().padding(vertical = Tokens.Space.s4.dp),
            verticalArrangement = Arrangement.spacedBy(Tokens.Space.s4.dp),
        ) {
            if (lobby?.asking == true) LobbyHandleView(lobby)
            Text(
                Words.Mock.setupTitle.uppercase(),
                style = Faces.head.copy(fontSize = Faces.head.fontSize * DISPLAY_SCALE),
                color = c.ink,
                modifier = Modifier.padding(horizontal = Tokens.Space.s3.dp).semantics { heading() },
            )
            Cells(
                form.cells,
                Modifier.padding(horizontal = Tokens.Space.s3.dp).semantics(mergeDescendants = true) {
                    contentDescription = Words.MockClocks.label
                },
            )
            ChipLine(Words.Mock.scoring, form.scoringChips, form.settings.scoring.preset, actions.scoring, still)
            ChipLine(Words.Mock.teams, form.teamChips, form.settings.teams, actions.teams, still)
            Slots(form, actions.slot)
            ChipLine(Words.Mock.lineup, form.lineupChips, form.settings.lineup, actions.lineup, still)
            lobby?.takeIf { it.listed }?.let { LobbyListView(it) }
        }
        Pin(form, actions.start, lobby)
    }
}

/** Tokens.Type.display over Tokens.Type.head: the page title's size in the head's face. */
private const val DISPLAY_SCALE = Tokens.Type.display / Tokens.Type.head

@Composable
private fun <Value> ChipLine(
    label: String,
    chips: List<BoardChip<Value>>,
    pressed: Value?,
    choose: (Value) -> Unit,
    still: Boolean,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp)) {
        HeadText(label, Modifier.padding(horizontal = Tokens.Space.s3.dp), end = false, lines = 1)
        Box(Modifier.padding(horizontal = Tokens.Space.s3.dp)) {
            // A preset this build does not know (a league's own rules) presses no chip.
            ChipRow<Value?>(chips.map { it.label to it.value }, pressed, { it?.let(choose) }, still = still, label = label)
        }
    }
}

/** Your slot: one chip per team and Random, wrapping as the web's loose group does. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Slots(
    form: MockSetupForm,
    choose: (Int?) -> Unit,
) {
    Column(Modifier.padding(horizontal = Tokens.Space.s3.dp), verticalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp)) {
        HeadText(Words.Mock.slot, end = false, lines = 1)
        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp),
            verticalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp),
        ) {
            form.slots.filterNotNull().forEach { slot -> ChoiceChip(slot.toString(), slot == form.settings.slot) { choose(slot) } }
        }
        ChoiceChip(Words.Mock.random, form.settings.slot == null) { choose(null) }
    }
}

/** The one verb pinned at the foot, the reason under it when a start did not go. */
@Composable
private fun Pin(
    form: MockSetupForm,
    start: () -> Unit,
    lobby: LobbySetup?,
) {
    val c = CommishTheme.colors
    Column(
        Modifier
            .fillMaxWidth()
            .background(c.bg)
            .drawBehind { drawRect(c.line, Offset.Zero, Size(size.width, 1.dp.toPx())) }
            .padding(horizontal = Tokens.Space.s3.dp, vertical = Tokens.Space.s2.dp),
        verticalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp),
    ) {
        form.problem?.let { NoteText(it) }
        Row(horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s3.dp), verticalAlignment = Alignment.CenterVertically) {
            Verb(Words.Mock.start, Modifier.weight(1f), enabled = !form.busy, onClick = start)
            lobby?.let { QuietButton(Words.Lobby.joinWithPeople, enabled = it.enabled && !form.busy, onClick = it.joinNearest) }
        }
    }
}
