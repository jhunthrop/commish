package app.trycommish.feature.rankings

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
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import app.trycommish.core.AppWords
import app.trycommish.core.rankings.RankingsChip
import app.trycommish.core.rankings.RankingsContent
import app.trycommish.core.rankings.RankingsModel
import app.trycommish.core.rankings.RankingsRow
import app.trycommish.core.rankings.RankingsSection
import app.trycommish.core.rankings.RankingsState
import app.trycommish.core.rankings.RankingsUi
import app.trycommish.core.rankings.WeekRankingsModel
import app.trycommish.core.rankings.WeekRankingsRow
import app.trycommish.core.rankings.WeekSection
import app.trycommish.core.shell.SheetPlayer
import app.trycommish.design.CommishTheme
import app.trycommish.design.QuietButton
import app.trycommish.design.Tokens
import app.trycommish.design.Words
import app.trycommish.feature.boxscore.BasisText
import app.trycommish.feature.boxscore.ChipRow
import app.trycommish.feature.boxscore.PageHead
import app.trycommish.feature.boxscore.ProblemLine
import app.trycommish.feature.boxscore.ScreenFailed
import app.trycommish.feature.boxscore.SearchField
import app.trycommish.feature.boxscore.SectionRow
import app.trycommish.feature.boxscore.TableFrame

/** What the screen's controls do: a name opens the player sheet, a chip chooses, the search's letters,
 * Show more, a pull reads again. */
class RankingsActions(
    val open: (SheetPlayer) -> Unit = {},
    val choose: (RankingsChip?) -> Unit = {},
    val find: (String) -> Unit = {},
    val more: () -> Unit = {},
    val refresh: () -> Unit = {},
)

/** What the page's head and controls say: the name, the sentence under it, the stamp over a saved read. */
class RankingsHead(
    val name: String,
    val lead: String?,
    val stamp: String?,
)

/**
 * The Rankings as the view model says them (the iOS RankingsView's twin): the saved read at once, then
 * the API's; a pull reads again; a row's name opens the player sheet by his id. The screen decides
 * nothing: the state, the chips, the search and the stamp are the view model's.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RankingsScreen(
    ui: RankingsUi,
    head: RankingsHead,
    refreshing: Boolean,
    actions: RankingsActions,
    modifier: Modifier = Modifier,
) {
    PullToRefreshBox(
        isRefreshing = refreshing,
        onRefresh = actions.refresh,
        modifier = modifier.fillMaxSize().background(CommishTheme.colors.bg),
    ) {
        when (val state = ui.state) {
            RankingsState.Loading -> Box(Modifier.fillMaxSize(), Alignment.Center) { CircularProgressIndicator() }
            RankingsState.SignedOut -> ScreenFailed(AppWords.signedOut, null)
            is RankingsState.Failed -> ScreenFailed(state.message, actions.refresh)
            is RankingsState.Loaded ->
                RankingsPage(state.content, ui, head, actions, Modifier.fillMaxSize().verticalScroll(rememberScrollState()))
        }
    }
}

/**
 * The Rankings in the web's order at 390: the head, the search and the chips, then our order with Show
 * more and its basis once, or the week's. Drawn whole; `rows` limits the rows a snapshot draws and
 * `still` draws the field at rest and the chips unscrolled.
 */
@Composable
fun RankingsPage(
    content: RankingsContent,
    ui: RankingsUi,
    head: RankingsHead,
    actions: RankingsActions,
    modifier: Modifier = Modifier,
    rows: Int? = null,
    still: Boolean = false,
) {
    Column(
        modifier.background(CommishTheme.colors.bg).padding(horizontal = Tokens.Space.s3.dp, vertical = Tokens.Space.s4.dp),
        verticalArrangement = Arrangement.spacedBy(Tokens.Space.s4.dp),
    ) {
        PageHead(head.name, head.lead, head.stamp)
        val hits = (content as? RankingsContent.Order)?.model?.hits
        Column(verticalArrangement = Arrangement.spacedBy(Tokens.Space.s3.dp)) {
            SearchField(ui.query, Words.Order.search, hits, actions.find, still)
            ChipRow(CHIPS, ui.chip, actions.choose, still, Words.InSeason.position)
        }
        ProblemLine(ui.problem)
        when (content) {
            is RankingsContent.Order -> {
                OrderTable(content.model, first(content.model.sections, rows), actions.open)
                if (ui.more && rows == null) {
                    QuietButton(Words.Order.moreRows, Modifier.fillMaxWidth(), actions.more)
                }
                if (rows == null || content.model.none != null) BasisText(content.model.basis)
            }
            is RankingsContent.Week -> WeekTable(content.model, first(content.model.sections, rows), actions.open)
        }
    }
}

/** The chips: All, our order's four, the week's K and D/ST. */
private val CHIPS: List<Pair<String, RankingsChip?>> = listOf(Words.Order.every to null) + RankingsChip.entries.map { it.word to it }

/** Our order as a box score (OrderTable.svelte at 390): the heads, the rows that play, the byes under their
 * head; or the line when a filter leaves none. */
@Composable
private fun OrderTable(
    model: RankingsModel,
    sections: List<RankingsSection<RankingsRow>>,
    open: (SheetPlayer) -> Unit,
) {
    val none = model.none
    if (none != null) {
        BasisText(none)
        return
    }
    Box(Modifier.semantics { contentDescription = Words.Order.rankGroup }) {
        TableFrame {
            RankingsHeadRow(model.heads)
            sections.forEach { section ->
                section.head?.let { SectionRow(it) }
                section.rows.forEach { RankingsRowView(it, open) }
            }
        }
    }
}

/** The kickers' or defenses' week (WeekScreen.svelte at 390): its basis line with the rules our stats lack
 * over the rows, the status line before the week's projection is in, the rows in their sections, or the
 * line when a search matches none. */
@Composable
private fun WeekTable(
    model: WeekRankingsModel,
    sections: List<RankingsSection<WeekRankingsRow>>,
    open: (SheetPlayer) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Tokens.Space.s3.dp)) {
        BasisText(listOfNotNull(model.basis, model.rules).joinToString(" "))
        model.status?.let { BasisText(it) }
        val none = model.none
        if (none != null) {
            BasisText(none)
            return@Column
        }
        Box(Modifier.semantics { contentDescription = model.heading }) {
            TableFrame {
                WeekHeadRow(model.proj)
                sections.forEach { section ->
                    section.head?.let { SectionRow(it) }
                    section.rows.forEach { WeekRankingsRowView(it, model.proj, section.key == WeekSection.KickedOff.key, open) }
                }
            }
        }
    }
}

/** The sections up to `rows` rows, every row with none. */
internal fun <Row> first(
    sections: List<RankingsSection<Row>>,
    rows: Int?,
): List<RankingsSection<Row>> {
    if (rows == null) return sections
    var left = rows
    return sections.mapNotNull { section ->
        if (left <= 0) return@mapNotNull null
        val kept = section.rows.take(left)
        left -= kept.size
        section.copy(rows = kept)
    }
}
