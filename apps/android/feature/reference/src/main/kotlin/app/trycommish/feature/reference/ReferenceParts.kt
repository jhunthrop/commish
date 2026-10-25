package app.trycommish.feature.reference

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.trycommish.core.reference.RunScreenState
import app.trycommish.core.shell.SheetPlayer
import app.trycommish.core.shell.SiteLinks
import app.trycommish.design.CommishTheme
import app.trycommish.design.Faces
import app.trycommish.design.Tokens
import app.trycommish.design.Words
import app.trycommish.feature.boxscore.FitText
import app.trycommish.feature.boxscore.ScreenFailed

/** What a reference screen's controls do: a row opens the player sheet, a link opens its page (a club, ADP
 * in another format, Compare), which the app pushes as its own screen. */
class ReferenceActions(
    val open: (SheetPlayer) -> Unit = {},
    val link: (String) -> Unit = {},
) {
    /** A club chip: the club's page. */
    fun club(abbr: String) = link(SiteLinks.club(abbr))
}

/** Tokens.Type.display over Tokens.Type.head: a page title's size in the head's face. */
private const val DISPLAY_SCALE = Tokens.Type.display / Tokens.Type.head

/** A reference page's head (web PageHead at 390): the heading in the number face, the run's stamp, the
 * page's lead, and over a saved screen why it shows (or the notice of a chip that could not be read). */
@Composable
fun ReferenceHead(
    heading: String,
    stamp: String?,
    lead: String? = null,
    stale: String? = null,
    modifier: Modifier = Modifier,
) {
    val c = CommishTheme.colors
    Column(modifier.fillMaxWidth().padding(horizontal = Tokens.Space.s3.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(
            heading.uppercase(),
            style = Faces.head.copy(fontSize = Faces.head.fontSize * DISPLAY_SCALE),
            color = c.ink,
            modifier = Modifier.semantics { heading() },
        )
        stamp?.let { Text(it, style = Faces.label.copy(letterSpacing = Faces.small.letterSpacing), color = c.ink3) }
        lead?.let {
            Text(
                it,
                style = Faces.small.copy(fontWeight = FontWeight.Medium),
                color = c.ink2,
                modifier = Modifier.padding(top = Tokens.Space.s1.dp),
            )
        }
        stale?.let {
            Text(
                it,
                style = Faces.label.copy(letterSpacing = Faces.small.letterSpacing),
                color = c.accentText,
                modifier = Modifier.padding(top = Tokens.Space.s1.dp),
            )
        }
    }
}

/** A column head over a table's figures: the small caps the board's heads use, shrunk to fit its cell
 * rather than cut. */
@Composable
fun ColumnHead(
    words: String,
    modifier: Modifier = Modifier,
    align: TextAlign = TextAlign.End,
) {
    FitText(words.uppercase(), Faces.label, CommishTheme.colors.ink3, modifier, maxLines = 2, textAlign = align)
}

/** A figure in a row, in the number face, the empty figure quiet. */
@Composable
fun RowFigure(
    text: String,
    modifier: Modifier = Modifier,
    ink: Color = CommishTheme.colors.ink2,
    style: TextStyle = Faces.cell.copy(fontSize = Tokens.Type.lg.sp),
    align: TextAlign = TextAlign.End,
) {
    val color = if (text == Words.Box.none) CommishTheme.colors.ink3 else ink
    FitText(text, style, color, modifier, textAlign = align)
}

/** The basis, said once at the foot. */
@Composable
fun BasisLines(
    lines: List<String>,
    modifier: Modifier = Modifier,
) {
    Column(modifier.padding(horizontal = Tokens.Space.s3.dp), verticalArrangement = Arrangement.spacedBy(Tokens.Space.s1.dp)) {
        lines.forEach { Text(it, style = Faces.small, color = CommishTheme.colors.ink3) }
    }
}

/**
 * A reference screen over its view model's state: a spinner until the first read; the screen in a scroll
 * that a pull reads again, with the one verb pinned above the bar; the words and Try again where nothing
 * could be read.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun <Model> RunScreenFrame(
    state: RunScreenState<Model>,
    refreshing: Boolean,
    refresh: () -> Unit,
    pin: @Composable (Model) -> Unit = {},
    content: @Composable (Model) -> Unit,
) {
    val c = CommishTheme.colors
    Column(Modifier.fillMaxSize().background(c.bg)) {
        PullToRefreshBox(
            isRefreshing = refreshing && state is RunScreenState.Loaded,
            onRefresh = refresh,
            modifier = Modifier.weight(1f),
        ) {
            when (state) {
                RunScreenState.Loading -> Box(Modifier.fillMaxSize(), Alignment.Center) { CircularProgressIndicator() }
                is RunScreenState.Failed -> ScreenFailed(state.words, refresh)
                is RunScreenState.Loaded -> content(state.model)
            }
        }
        (state as? RunScreenState.Loaded)?.let { pin(it.model) }
    }
}
