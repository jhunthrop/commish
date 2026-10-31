package app.trycommish.feature.waivers

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
import androidx.compose.ui.unit.dp
import app.trycommish.core.AppWords
import app.trycommish.core.shell.SheetPlayer
import app.trycommish.core.waivers.PanelMode
import app.trycommish.core.waivers.WaiverModel
import app.trycommish.core.waivers.WaiverPin
import app.trycommish.core.waivers.WaiverSortKey
import app.trycommish.core.waivers.WaiverState
import app.trycommish.core.waivers.WaiverUi
import app.trycommish.design.CommishTheme
import app.trycommish.design.Tokens
import app.trycommish.feature.boxscore.BasisText
import app.trycommish.feature.boxscore.ScreenFailed

/** What the screen's controls do: a row's name opens the player sheet by the row's key, a strip card is
 * chosen, a row's button opens its drop panel, a drop is chosen, a position card reads its position (All
 * the page's rows), the toggle sets the cards and the list's order, the search finds, a head sorts; the
 * pin's verb, confirmation, way out and bid; a pull reads again. */
class WaiverActions(
    val open: (SheetPlayer) -> Unit = {},
    val chooseCard: (String) -> Unit = {},
    val tapRow: (String) -> Unit = {},
    val chooseDrop: (String) -> Unit = {},
    val chooseNav: (String) -> Unit = {},
    val find: (String) -> Unit = {},
    val sortBy: (WaiverSortKey) -> Unit = {},
    val choosePanelMode: (PanelMode) -> Unit = {},
    val refresh: () -> Unit = {},
    val pin: WaiverPinActions = WaiverPinActions(),
)

/** The screen's runs, top to bottom: each a snapshot of its own, so no reference grows past what a
 * repository keeps. */
enum class WaiverPart {
    /** The strip, the position cards, the search, and the rows that gain. */
    Top,

    /** The rest under the divider, the Stash group and the basis. */
    Foot,
}

/**
 * The Waivers screen (web WaiverScreen.svelte at 390): the strip, the position cards that navigate it with
 * the chosen card's line, the search, the line when the week's projection is still to come, the table (the
 * member's players at the chosen position over the free agents there), the basis once at the foot, in the web's
 * order, and the one verb pinned above the bar. Pull down to read again. The screen decides nothing: the
 * state, the stamp and the pin are the view model's.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WaiverScreen(
    ui: WaiverUi,
    stamp: String?,
    pin: WaiverPin,
    refreshing: Boolean,
    actions: WaiverActions,
    modifier: Modifier = Modifier,
    /** Draws the cards and the search at rest (a store shot, which draws one frame and no scroll). */
    still: Boolean = false,
) {
    Column(modifier.fillMaxSize().background(CommishTheme.colors.bg)) {
        PullToRefreshBox(isRefreshing = refreshing, onRefresh = actions.refresh, modifier = Modifier.weight(1f).fillMaxWidth()) {
            when (val state = ui.state) {
                WaiverState.Loading -> Box(Modifier.fillMaxSize(), Alignment.Center) { CircularProgressIndicator() }
                is WaiverState.Failed -> ScreenFailed(state.message, actions.refresh)
                WaiverState.SignedOut -> ScreenFailed(AppWords.signedOut, null)
                is WaiverState.Loaded ->
                    WaiverPage(
                        state.model,
                        ui,
                        stamp,
                        actions,
                        WaiverPart.entries,
                        Modifier.fillMaxSize().verticalScroll(rememberScrollState()),
                        still,
                    )
            }
        }
        if (!pin.isEmpty) WaiverPinView(pin, actions.pin)
    }
}

/** The page's runs at their full height: the screen scrolls them, a snapshot draws each whole. */
@Composable
fun WaiverPage(
    model: WaiverModel,
    ui: WaiverUi,
    stamp: String?,
    actions: WaiverActions,
    parts: List<WaiverPart>,
    modifier: Modifier = Modifier,
    /** Draws the search at rest (a snapshot). */
    still: Boolean = false,
) {
    val table = tableActions(ui, actions)
    Column(
        modifier.background(CommishTheme.colors.bg).padding(horizontal = Tokens.Space.s3.dp, vertical = Tokens.Space.s4.dp),
        verticalArrangement = Arrangement.spacedBy(Tokens.Space.s4.dp),
    ) {
        // The whole page is one table, its heads drawn once (review M1); a part alone (a snapshot) draws
        // its own rows under its own heads.
        val whole = WaiverPart.Top in parts && WaiverPart.Foot in parts
        parts.forEach { part ->
            when (part) {
                WaiverPart.Top -> {
                    WaiverStrip(model, stamp, ui.card?.key, actions.chooseCard)
                    WaiverNavView(navActions(ui, actions, still))
                    Filters(
                        WaiverControls(
                            ui.query,
                            actions.find,
                            ui.problem,
                            ui.sort,
                            actions.sortBy,
                            still,
                        ),
                    )
                    model.arrives?.let { BasisText(it) }
                    WaiverTableView(model, if (whole) TableGroup.Page else setOf(TableGroup.Gaining), table)
                }
                WaiverPart.Foot -> {
                    if (!whole) WaiverTableView(model, setOf(TableGroup.Rest, TableGroup.Stash), table)
                    BasisText(model.basis)
                }
            }
        }
    }
}

/** The open row with its drop panel under the heads (the snapshot's panel part). */
@Composable
fun WaiverOpenRow(
    model: WaiverModel,
    ui: WaiverUi,
    actions: WaiverActions,
    modifier: Modifier = Modifier,
) {
    Column(modifier.background(CommishTheme.colors.bg).padding(horizontal = Tokens.Space.s3.dp, vertical = Tokens.Space.s4.dp)) {
        WaiverTableView(model, setOf(TableGroup.Opened), tableActions(ui, actions))
    }
}

private fun navActions(
    ui: WaiverUi,
    actions: WaiverActions,
    still: Boolean,
): NavActions =
    NavActions(
        cards = ui.nav,
        chosen = ui.navKey,
        mode = ui.panelMode,
        hasWeek = ui.navHasWeek,
        lead = ui.lead,
        choose = actions.chooseNav,
        chooseMode = actions.choosePanelMode,
        still = still,
    )

private fun tableActions(
    ui: WaiverUi,
    actions: WaiverActions,
): TableActions {
    val model = ui.model
    val opened = ui.opened
    return TableActions(
        open = actions.open,
        tap = actions.tapRow,
        chooseDrop = actions.chooseDrop,
        opened = ui.openRow,
        drops = ui.drops,
        chosenDrop = ui.chosenDrop,
        dropHead = if (model != null && opened != null) model.dropHead(opened) else null,
        table = ui.table,
        sort = ui.sort,
        onSort = actions.sortBy,
        reading = ui.reading,
        compare = ui.compare,
        empty = ui.empty,
    )
}
