package app.trycommish.feature.trades

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
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
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.trycommish.core.AppWords
import app.trycommish.core.shell.SheetPlayer
import app.trycommish.core.shell.SiteLinks
import app.trycommish.core.trades.CopiedLine
import app.trycommish.core.trades.PickSide
import app.trycommish.core.trades.TradeSort
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

private const val NARROWING_ALPHA = 0.6f
private val CHIP_HEIGHT = 30.dp

/** What the screen's controls do: a name opens the player sheet by his id, a row opens or closes its
 * trade, a verb copies the trade's offer and opens the platform's page, the chips and the gain heads
 * reorder the finder, the picker narrows it to a player, the builder opens, picks, checks and copies; a
 * pull reads again. */
class TradeActions(
    val open: (SheetPlayer) -> Unit = {},
    val toggle: (String) -> Unit = {},
    val press: (String) -> Unit = {},
    val showEvery: (Boolean) -> Unit = {},
    val sort: (TradeSort) -> Unit = {},
    val pick: (String?) -> Unit = {},
    val refresh: () -> Unit = {},
    val builder: BuilderActions = BuilderActions(),
)

/** What the builder's controls do: open it new or from a trade, close it, choose the team, tick a player,
 * press its verb. */
class BuilderActions(
    val new: () -> Unit = {},
    val from: (String) -> Unit = {},
    val close: () -> Unit = {},
    val team: (Int) -> Unit = {},
    val tap: (PickSide, String) -> Unit = { _, _ -> },
    val press: () -> Unit = {},
)

/** The screen's runs, top to bottom: each a snapshot of its own, so no reference grows past what a
 * repository keeps. */
enum class TradesPart {
    /** The strip, or the decision where no trade is worth proposing or none holds the player picked. */
    Strip,

    /** The builder, while it is open. */
    Builder,

    /** The picker, the chips, Build a trade, and the finder with any trade opened in it. */
    Finder,

    /** The basis and the record's link. */
    Basis,
}

/**
 * The Trades screen (web TradeScreen.svelte at 390): the strip of the trades worth proposing, the builder
 * while it is open, the picker with the chips and Build a trade, the finder with any trade opened, the
 * basis once at the foot with the record's link, in the web's order; the builder's gains and verb pinned
 * above the bar while it is open. Pull down to read again. The screen decides nothing: the state and the
 * stamp are the view model's.
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
            when (val state = ui.state) {
                TradesState.Loading -> Box(Modifier.fillMaxSize(), Alignment.Center) { CircularProgressIndicator() }
                is TradesState.Failed -> ScreenFailed(state.message, actions.refresh)
                TradesState.SignedOut -> ScreenFailed(AppWords.signedOut, null)
                is TradesState.Loaded ->
                    TradesPage(
                        state.model,
                        ui,
                        stamp,
                        actions,
                        TradesPart.entries,
                        Modifier.fillMaxSize().verticalScroll(rememberScrollState()),
                    )
            }
        }
        val model = ui.model
        val builder = ui.builder
        if (model != null && builder != null) {
            BuilderPin(builder, model.verb, model.page, ui.builderCopied, actions.builder.press)
        }
    }
}

/** The page's runs at their full height: the screen scrolls them, a snapshot draws each whole. */
@Composable
fun TradesPage(
    model: TradesModel,
    ui: TradesUi,
    stamp: String?,
    actions: TradeActions,
    parts: List<TradesPart>,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier.background(CommishTheme.colors.bg).padding(vertical = Tokens.Space.s4.dp),
        verticalArrangement = Arrangement.spacedBy(Tokens.Space.s4.dp),
    ) {
        parts.forEach { part -> TradesPartView(part, model, ui, stamp, actions) }
    }
}

/** One run of the page. */
@Composable
fun TradesPartView(
    part: TradesPart,
    model: TradesModel,
    ui: TradesUi,
    stamp: String?,
    actions: TradeActions,
) {
    val builder = ui.builder
    if (part == TradesPart.Builder && builder == null) return
    Column(
        Modifier.padding(horizontal = Tokens.Space.s3.dp),
        verticalArrangement = Arrangement.spacedBy(Tokens.Space.s3.dp),
    ) {
        when (part) {
            TradesPart.Strip -> {
                val strip = model.strip
                if (strip != null) {
                    TradeStripView(strip, model.verb, model.page != null, stamp, ui.copied, model.page, actions.press)
                } else {
                    Decision(model.decision, stamp)
                }
            }
            TradesPart.Builder -> if (builder != null) TradeBuilderView(builder, ui.checking, actions)
            TradesPart.Finder -> {
                ToolsRow(model, ui.every, actions)
                ui.problem?.let { ProblemText(it) }
                Box(Modifier.alpha(if (ui.narrowing) NARROWING_ALPHA else 1f)) { TradeFinderView(model, ui, actions) }
            }
            TradesPart.Basis -> BasisFoot(model.basis(ui.open))
        }
    }
}

/** No trade worth proposing, or none holding the player picked: the decision in the screen's large face,
 * the stamp of a saved read under. */
@Composable
private fun Decision(
    decision: String,
    stamp: String?,
) {
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(decision, style = Faces.section, color = CommishTheme.colors.ink, modifier = Modifier.semantics { heading() })
        stamp?.let { StampText(it) }
    }
}

/** "Last read Sat 12:00 pm": a saved read's stamp, in the accent's ink. */
@Composable
internal fun StampText(stamp: String) {
    Text(stamp, style = Faces.label.copy(letterSpacing = 0.sp), color = CommishTheme.colors.accentText)
}

/** A read that could not be made, in the loss's ink (ProblemLine.svelte). */
@Composable
private fun ProblemText(text: String) {
    Text(text, style = Faces.small.copy(fontWeight = FontWeight.SemiBold), color = CommishTheme.colors.lossInk)
}

/** TradeScreen's tools: Trades holding with its choice (every trade, your players, their players), each
 * team's best or every trade with their counts, and Build a trade. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ToolsRow(
    model: TradesModel,
    every: Boolean,
    actions: TradeActions,
) {
    val c = CommishTheme.colors
    Column(verticalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp)) {
            Text(Words.InSeason.tradesHolding, style = Faces.small, color = c.ink2)
            val picker = model.picker
            ChoiceField(
                label = Words.InSeason.tradesHolding,
                value = picker.label,
                chosen = picker.chosen.orEmpty(),
                groups =
                    listOf(
                        ChoiceGroup(null, listOf(Choice("", Words.TradePicker.every))),
                        ChoiceGroup(Words.InSeason.yourPlayers, picker.yours.map { Choice(it.key, it.name) }),
                        ChoiceGroup(Words.InSeason.theirPlayers, picker.theirs.map { Choice(it.key, it.name) }),
                    ),
                modifier = Modifier.weight(1f),
            ) { key -> actions.pick(key.ifEmpty { null }) }
        }
        FlowRow(
            Modifier.semantics { contentDescription = Words.Trades.every },
            horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp),
        ) {
            Chip(model.best, !every) { actions.showEvery(false) }
            Chip(model.every, every) { actions.showEvery(true) }
        }
        Row(Modifier.fillMaxWidth()) {
            Spacer(Modifier.weight(1f))
            OutlinedQuiet(Words.Builder.open, actions.builder.new)
        }
    }
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
    onBoard: Boolean = false,
) {
    val c = CommishTheme.colors
    val uri = LocalUriHandler.current
    val quiet = if (onBoard) c.scoreboardInk2 else c.ink2
    val strong = if (onBoard) c.scoreboardInk else c.ink
    Text(
        buildAnnotatedString {
            withStyle(SpanStyle(color = quiet)) { append("${line.said} ${Words.Trades.proposeItOn} ") }
            withStyle(
                SpanStyle(
                    color = strong,
                    fontWeight = FontWeight.SemiBold,
                    textDecoration = if (page != null) TextDecoration.Underline else null,
                ),
            ) { append(line.page) }
            withStyle(SpanStyle(color = quiet)) { append(".") }
        },
        style = Faces.small,
        modifier =
            Modifier
                .fillMaxWidth()
                .semantics { contentDescription = line.words }
                .then(if (page != null) Modifier.clickableLink(line.page) { uri.openUri(page) } else Modifier),
    )
}
