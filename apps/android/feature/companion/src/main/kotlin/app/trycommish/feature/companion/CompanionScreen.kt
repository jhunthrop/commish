package app.trycommish.feature.companion

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import app.trycommish.core.AppWords
import app.trycommish.core.companion.CompanionFailure
import app.trycommish.core.companion.CompanionModel
import app.trycommish.core.companion.CompanionState
import app.trycommish.core.companion.PoolModel
import app.trycommish.design.CommishTheme
import app.trycommish.design.QuietButton
import app.trycommish.design.Tokens
import app.trycommish.design.Verb
import app.trycommish.design.Words

/** A part of the followed draft's screen, so a snapshot can frame the one it is of. */
enum class CompanionPart { Head, Strips, Call, Pool, Wall, Team }

/**
 * The followed draft as its model says it, in the web's order at 390 (CompanionRoom.svelte), the approved
 * iOS screen's: the reconnecting line over picks that are not the latest, the bar, the line when our draft
 * stops following, the notes, the picks as they land (or at your turn the picks since your last), our call
 * and who we would take next, the pool, the wall, your team. Pure of state, so a snapshot draws it from the
 * fixture; `still` lays the strips, chips and wall at rest.
 */
@Composable
fun CompanionRoom(
    model: CompanionModel,
    stale: String?,
    actions: CompanionActions,
    modifier: Modifier = Modifier,
    shown: Int = PoolModel.FIRST_ROWS,
    still: Boolean = false,
    parts: Set<CompanionPart> = CompanionPart.entries.toSet(),
) {
    Column(modifier.padding(vertical = Tokens.Space.s3.dp), verticalArrangement = Arrangement.spacedBy(Tokens.Space.s3.dp)) {
        if (CompanionPart.Head in parts) Head(model, stale, actions)
        if (CompanionPart.Strips in parts) {
            model.strip?.let { PickStripView(it, actions.open, still) }
            model.since?.let { PickStripView(it, actions.open, still) }
        }
        if (CompanionPart.Call in parts) {
            model.call?.let { CallPanelView(it, actions.open, actions.openDraft) }
            model.shortlist?.takeIf { it.isNotEmpty() }?.let { ShortlistView(it, actions.open) }
        }
        if (CompanionPart.Pool in parts) model.pool?.let { PoolView(it, shown, actions, still) }
        if (CompanionPart.Wall in parts) WallView(model.wall, actions.open, still)
        if (CompanionPart.Team in parts) TeamView(model.team, actions.open)
    }
}

/** The reconnecting line with its stamp, the bar, the line when our draft stops following, the notes. */
@Composable
private fun Head(
    model: CompanionModel,
    stale: String?,
    actions: CompanionActions,
) {
    val c = CommishTheme.colors
    stale?.let {
        Panel(Edge.Quiet, Modifier.semantics { liveRegion = LiveRegionMode.Polite }) {
            NoteText(Words.Companion.reconnecting)
            NoteText(it, ink = c.accentText)
        }
    }
    CompanionBarView(model.bar, actions.openDraft)
    model.lost?.let { Panel(Edge.Loss) { NoteText(it) } }
    model.notes.forEach { NoteText(it, Modifier.padding(horizontal = Tokens.Space.s3.dp)) }
}

/**
 * The followed draft's screen from its view model's state: the room (pull to refresh joins the read in
 * flight, never faster than the poll), the report once the draft is over, or the words for why it cannot
 * be shown. The poll itself is the caller's: visible while the screen is on screen with the app started.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CompanionScreen(
    state: CompanionState,
    stale: String?,
    refreshing: Boolean,
    shown: Int,
    actions: CompanionActions,
    refresh: () -> Unit,
    retry: () -> Unit,
) {
    val ground = Modifier.fillMaxSize().background(CommishTheme.colors.bg)
    when (state) {
        CompanionState.Loading -> Box(ground, Alignment.Center) { CircularProgressIndicator() }
        is CompanionState.Room ->
            PullToRefreshBox(isRefreshing = refreshing, onRefresh = refresh, modifier = ground) {
                CompanionRoom(state.model, stale, actions, Modifier.fillMaxWidth().verticalScroll(rememberScrollState()), shown)
            }
        is CompanionState.Report ->
            DraftReportScreen(state.report, actions, ground.verticalScroll(rememberScrollState()))
        is CompanionState.Failed -> CompanionFailed(state.failure, actions.followAnother, retry, ground)
    }
}

/** The page's words when the draft cannot be shown (CompanionPage.svelte): signed out, not on this
 * account, or never read. */
@Composable
internal fun CompanionFailed(
    failure: CompanionFailure,
    followAnother: () -> Unit,
    retry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier.padding(Tokens.Space.s5.dp), verticalArrangement = Arrangement.spacedBy(Tokens.Space.s3.dp)) {
        when (failure) {
            CompanionFailure.SignedOut -> {
                SectionHead(Words.Companion.signedOutTitle)
                NoteText(Words.Companion.signedOutLine)
            }
            CompanionFailure.Missing -> {
                SectionHead(Words.Companion.missingTitle)
                NoteText(Words.Companion.missingLine)
                Verb(Words.Companion.followADraft, onClick = followAnother)
            }
            CompanionFailure.Unreachable -> {
                SectionHead(Words.Companion.unreachableTitle)
                NoteText(Words.Companion.reloadLine)
                QuietButton(AppWords.tryAgain, onClick = retry)
            }
        }
    }
}
