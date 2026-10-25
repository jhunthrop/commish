package app.trycommish.feature.matchup

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
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
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import app.trycommish.core.AppWords
import app.trycommish.core.matchup.MatchupModel
import app.trycommish.core.matchup.MatchupState
import app.trycommish.core.matchup.MatchupWeek
import app.trycommish.core.shell.SheetPlayer
import app.trycommish.design.CommishTheme
import app.trycommish.design.Faces
import app.trycommish.design.NumWeight
import app.trycommish.design.Tokens
import app.trycommish.design.Words
import app.trycommish.feature.boxscore.BasisText
import app.trycommish.feature.boxscore.RowActions
import app.trycommish.feature.boxscore.ScreenFailed

private const val TITLE_TRACKING = 0.04

/** What the screen's controls do: a row's name opens the player sheet by his id; a pull reads again. */
class MatchupActions(
    val open: (SheetPlayer) -> Unit = {},
    val refresh: () -> Unit = {},
)

/** The screen's runs, top to bottom, so a snapshot draws each part whole and no reference grows past what
 * a repository keeps: the title, the bug and its notes; the member's box; the opponent's box and the
 * basis. */
enum class MatchupPart { Head, Mine, Theirs }

/**
 * The Matchup screen (web MatchupScreen.svelte and MatchupPanel.svelte at 390): the week and both teams,
 * the score bug, its notes, the member's box, the opponent's, the basis once at the foot, in the web's
 * order. Pull down to read again. The screen decides nothing: the state and the stamp are the view
 * model's.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MatchupScreen(
    state: MatchupState,
    stamp: String?,
    refreshing: Boolean,
    actions: MatchupActions,
    modifier: Modifier = Modifier,
) {
    PullToRefreshBox(
        isRefreshing = refreshing,
        onRefresh = actions.refresh,
        modifier = modifier.fillMaxSize().background(CommishTheme.colors.bg),
    ) {
        when (state) {
            MatchupState.Loading -> Box(Modifier.fillMaxSize(), Alignment.Center) { CircularProgressIndicator() }
            is MatchupState.Failed -> ScreenFailed(state.message, actions.refresh)
            MatchupState.SignedOut -> ScreenFailed(AppWords.signedOut, null)
            is MatchupState.Loaded -> {
                val scroll = Modifier.fillMaxSize().verticalScroll(rememberScrollState())
                when (val model = state.model) {
                    is MatchupModel.Week ->
                        MatchupPage(model.week, stamp, RowActions(actions.open), MatchupPart.entries, scroll)
                    is MatchupModel.Gap ->
                        Box(scroll.padding(Tokens.Space.s3.dp)) { BasisText(model.sentence) }
                }
            }
        }
    }
}

/** The page's runs at their full height: the screen scrolls them, a snapshot draws each whole. */
@Composable
internal fun MatchupPage(
    week: MatchupWeek,
    stamp: String?,
    actions: RowActions,
    parts: List<MatchupPart>,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier.background(CommishTheme.colors.bg).padding(horizontal = Tokens.Space.s3.dp, vertical = Tokens.Space.s4.dp),
        verticalArrangement = Arrangement.spacedBy(Tokens.Space.s3.dp),
    ) {
        parts.forEach { part ->
            when (part) {
                MatchupPart.Head -> {
                    MatchupTitle(week, stamp)
                    MatchupBugView(week.bug)
                    week.notes.forEach { BasisText(it) }
                }
                MatchupPart.Mine -> week.boxes.firstOrNull()?.let { TeamBoxView(it, actions) }
                MatchupPart.Theirs -> {
                    week.boxes.drop(1).forEach { TeamBoxView(it, actions) }
                    week.noOpponent?.let { BasisText(it) }
                    BasisText(week.basis)
                }
            }
        }
    }
}

/** "Week 6" over both teams' names, "vs" between them in the quiet ink; a saved read's stamp under. */
@Composable
private fun MatchupTitle(
    week: MatchupWeek,
    stamp: String?,
) {
    val c = CommishTheme.colors
    val face = Faces.figure.copy(letterSpacing = TITLE_TRACKING.em)
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(
            week.week.uppercase(),
            style = Faces.number(NumWeight.Bold, Tokens.Type.md.sp).copy(letterSpacing = TITLE_TRACKING.em),
            color = c.accentText,
        )
        Text(
            buildAnnotatedString {
                append(week.mine.uppercase())
                week.opponent?.let { opponent ->
                    append(" ")
                    withStyle(SpanStyle(color = c.ink3)) { append(Words.Matchup.vs.uppercase()) }
                    append(" ")
                    append(opponent.uppercase())
                }
            },
            style = face,
            color = c.ink,
            modifier = Modifier.semantics { heading() },
        )
        stamp?.let { Text(it, style = Faces.label.copy(fontWeight = FontWeight.SemiBold, letterSpacing = 0.sp), color = c.accentText) }
    }
}
