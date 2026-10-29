package app.trycommish.feature.trades

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.trycommish.core.AppWords
import app.trycommish.core.shell.SheetPlayer
import app.trycommish.core.shell.SiteLinks
import app.trycommish.core.trades.CopiedLine
import app.trycommish.core.trades.PickSide
import app.trycommish.core.trades.RosterSwitch
import app.trycommish.core.trades.TradeBuilderModel
import app.trycommish.core.trades.TradesModel
import app.trycommish.core.trades.TradesState
import app.trycommish.core.trades.TradesUi
import app.trycommish.design.CommishTheme
import app.trycommish.design.Faces
import app.trycommish.design.Tokens
import app.trycommish.design.Words
import app.trycommish.feature.boxscore.BasisText
import app.trycommish.feature.boxscore.ScreenFailed
import app.trycommish.feature.boxscore.clickableLink
import app.trycommish.feature.boxscore.wrapCenter

private val CHIP_HEIGHT = 30.dp

/** What the screen's controls do: a name opens the player sheet by his id, an idea loads its ticks, "N
 * more" shows every idea, the switch shows a roster, the choice picks the team, a tick picks a player, the
 * verb copies the offer and opens the platform's page, Share copies the trade as text; a pull reads
 * again. */
class TradeActions(
    val open: (SheetPlayer) -> Unit = {},
    val idea: (String) -> Unit = {},
    val more: () -> Unit = {},
    val show: (PickSide) -> Unit = {},
    val team: (Int) -> Unit = {},
    val tap: (PickSide, String) -> Unit = { _, _ -> },
    val press: () -> Unit = {},
    val share: () -> Unit = {},
    val refresh: () -> Unit = {},
)

/**
 * The Trades as one experience (web TradeScreen.svelte at 390, builder-first since Lane 260, dense since
 * Lane 268): a saved read's stamp, our ideas row, the roster switch, the roster shown with a tick on every
 * row (the team chosen at the head of theirs), the verdict and its lines under it, the basis once at the
 * foot with the record's link; the gains, Share and the verb pinned above the bar. Pull down to read
 * again. The screen decides nothing: the state and the stamp are the view model's.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TradesScreen(
    ui: TradesUi,
    stamp: String?,
    refreshing: Boolean,
    actions: TradeActions,
    modifier: Modifier = Modifier,
) {
    Column(modifier.fillMaxSize().background(CommishTheme.colors.bg)) {
        PullToRefreshBox(isRefreshing = refreshing, onRefresh = actions.refresh, modifier = Modifier.weight(1f).fillMaxWidth()) {
            val builder = ui.builder
            when (val state = ui.state) {
                TradesState.Loading -> Box(Modifier.fillMaxSize(), Alignment.Center) { CircularProgressIndicator() }
                is TradesState.Failed -> ScreenFailed(state.message, actions.refresh)
                TradesState.SignedOut -> ScreenFailed(AppWords.signedOut, null)
                is TradesState.Loaded ->
                    if (builder != null) {
                        TradesPage(state.model, builder, ui, stamp, actions, Modifier.fillMaxSize().verticalScroll(rememberScrollState()))
                    }
            }
        }
        val model = ui.model
        val builder = ui.builder
        if (model != null && builder != null && ui.state is TradesState.Loaded) {
            BuilderPin(builder, model.verb, model.page, ui.checking, ui.builderCopied, ui.shared, actions)
        }
    }
}

/** The page at its full height: the screen scrolls it, a snapshot draws it whole. */
@Composable
fun TradesPage(
    model: TradesModel,
    builder: TradeBuilderModel,
    ui: TradesUi,
    stamp: String?,
    actions: TradeActions,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier.background(CommishTheme.colors.bg).padding(Tokens.Space.s3.dp),
        verticalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp),
    ) {
        TradesTop(builder, ui.drawn, stamp, actions)
        BuilderBoxView(builder, ui.drawn, actions)
        VerdictView(builder, ui.checking)
        Box(Modifier.padding(top = Tokens.Space.s2.dp)) { BasisFoot(model.basis) }
    }
}

/** The screen's head: a saved read's stamp, our ideas, the roster switch. */
@Composable
fun TradesTop(
    builder: TradeBuilderModel,
    drawn: PickSide,
    stamp: String?,
    actions: TradeActions,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp)) {
        stamp?.let { StampText(it) }
        if (builder.ideas.isNotEmpty()) TradeIdeasView(builder, actions)
        RosterSwitchView(builder.rosters, drawn, actions.show)
    }
}

/** The switch between the rosters as a phone stacks them (TradeBuilder's .switch): "You, 1" and
 * "Max_Jensen10, 2", one roster drawn at a time; the ticks are the picks, so they hold across it. */
@Composable
private fun RosterSwitchView(
    rosters: RosterSwitch,
    drawn: PickSide,
    show: (PickSide) -> Unit,
) {
    Row(
        Modifier.semantics { contentDescription = Words.Analyzer.rosters },
        horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp),
    ) {
        Chip(rosters.yours, drawn == PickSide.Give) { show(PickSide.Give) }
        Chip(rosters.theirs, drawn == PickSide.Get) { show(PickSide.Get) }
    }
}

/** "Last read Sat 12:00 pm": a saved read's stamp, in the accent's ink. */
@Composable
internal fun StampText(stamp: String) {
    Text(stamp, style = Faces.label.copy(letterSpacing = 0.sp), color = CommishTheme.colors.accentText)
}

/** A choice chip, lit in the ink when it is the one shown (the web's ChipGroup, iOS's ChoiceChip). */
@Composable
private fun Chip(
    words: String,
    lit: Boolean,
    choose: () -> Unit,
) {
    val c = CommishTheme.colors
    val pill = RoundedCornerShape(Tokens.Radius.pill.dp)
    Text(
        words,
        style = Faces.small.copy(fontWeight = FontWeight.SemiBold),
        color = if (lit) c.bg else c.ink2,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
        modifier =
            Modifier
                .height(CHIP_HEIGHT)
                .clip(pill)
                .background(if (lit) c.ink else Color.Transparent)
                .border(1.dp, if (lit) c.ink else c.lineStrong, pill)
                .clickable(role = Role.Button, onClick = choose)
                .semantics { selected = lit }
                .padding(horizontal = Tokens.Space.s3.dp)
                .wrapCenter(),
    )
}

/** The basis, then "How the order has done", which opens our record. */
@Composable
private fun BasisFoot(text: String) {
    val uri = LocalUriHandler.current
    Column(verticalArrangement = Arrangement.spacedBy(Tokens.Space.s1.dp)) {
        BasisText(text)
        Text(
            Words.InSeason.orderRecord,
            style = Faces.label.copy(fontWeight = FontWeight.Normal, letterSpacing = 0.sp, textDecoration = TextDecoration.Underline),
            color = CommishTheme.colors.ink2,
            modifier = Modifier.clickableLink(Words.InSeason.orderRecord) { uri.openUri(SiteLinks.RECORD) },
        )
    }
}

/** The line under a pressed verb: "Copied. Propose it on FFPC's trade page.", the page its link when the
 * platform's page is known. */
@Composable
internal fun CopiedText(
    line: CopiedLine,
    page: String?,
) {
    val c = CommishTheme.colors
    val uri = LocalUriHandler.current
    Text(
        buildAnnotatedString {
            withStyle(SpanStyle(color = c.ink2)) { append("${line.said} ${Words.Trades.proposeItOn} ") }
            withStyle(
                SpanStyle(
                    color = c.ink,
                    fontWeight = FontWeight.SemiBold,
                    textDecoration = if (page != null) TextDecoration.Underline else null,
                ),
            ) { append(line.page) }
            withStyle(SpanStyle(color = c.ink2)) { append(".") }
        },
        style = Faces.small,
        modifier =
            Modifier
                .fillMaxWidth()
                .semantics { contentDescription = line.words }
                .then(if (page != null) Modifier.clickableLink(line.page) { uri.openUri(page) } else Modifier),
    )
}
