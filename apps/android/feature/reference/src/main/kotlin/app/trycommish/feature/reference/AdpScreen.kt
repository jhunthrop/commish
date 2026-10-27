package app.trycommish.feature.reference

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.HorizontalDivider
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import app.trycommish.core.board.BoardChip
import app.trycommish.core.reference.AdpModel
import app.trycommish.core.reference.AdpRow
import app.trycommish.design.CommishTheme
import app.trycommish.design.Headshot
import app.trycommish.design.Tokens
import app.trycommish.design.Words
import app.trycommish.feature.board.RowWho
import app.trycommish.feature.board.gapInk
import app.trycommish.feature.board.roundTint
import app.trycommish.feature.board.tintTile
import app.trycommish.feature.boxscore.ChipRow

/** ADP's phone columns (board-columns.ts in the drafters' order): the ADP leading, his face, the player
 * taking the rest, then his points, his value and the Gap, 4 dp apart as on iOS. Where our board has him is
 * his pill's number and, before the draft, the Gap (Lane 199 review H1). Below 375 dp the figures narrow (the
 * web's phone band, Projected 48 and Over repl 54, the ADP and the Gap to their widest figure), so the player
 * keeps about 116 dp: his name whole and his pill, club and bye on one line (Lane 202 review H1). A figure
 * wider than its cell shrinks rather than cuts. */
private class AdpWidths(
    narrow: Boolean,
) {
    val adp = if (narrow) 36.dp else 40.dp
    val face = 32.dp
    val projected = if (narrow) 48.dp else 62.dp
    val overReplacement = if (narrow) 54.dp else 58.dp
    val gap = if (narrow) 38.dp else 44.dp

    /** The cells' spacing, which the round's tint behind Over repl reaches across to Projected's edge. */
    val spacing = 4.dp
    val row = 52.dp
    val head = 34.dp
}

/** The widths for this phone's width. */
@Composable
private fun adpWidths(): AdpWidths = AdpWidths(LocalConfiguration.current.screenWidthDp < NARROW_DP)

/** iOS SE's width: a phone narrower takes the narrow figures. */
private const val NARROW_DP = 375

/** ADP's controls: a row opens his sheet, a club chip its club, a format chip that format. */
class AdpActions(
    val reference: ReferenceActions = ReferenceActions(),
    val format: (String) -> Unit = {},
)

/** The heads, said once over the rows. */
@Composable
fun AdpHeadRow(model: AdpModel) {
    val c = CommishTheme.colors
    val widths = adpWidths()
    val heads = model.heads
    val trailing = listOfNotNull(widths.projected, widths.overReplacement, widths.gap.takeIf { model.gap })
    Column(Modifier.fillMaxWidth().background(c.bg)) {
        Row(
            Modifier.fillMaxWidth().heightIn(min = widths.head).padding(horizontal = Tokens.Space.s2.dp),
            horizontalArrangement = Arrangement.spacedBy(widths.spacing),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            ColumnHead(heads[0], Modifier.width(widths.adp))
            ColumnHead(heads[1], Modifier.weight(1f).padding(start = widths.face + widths.spacing), TextAlign.Start)
            heads.drop(2).zip(trailing).forEach { (words, width) -> ColumnHead(words, Modifier.width(width)) }
        }
        HorizontalDivider(color = c.line)
    }
}

/** One row (AdpView.svelte's Row at 390): his ADP leading in the number face, his face, name, pill, club
 * chip and bye, his status, then Projected, Over repl on its round's tint and the Gap in its tone. The row
 * opens his sheet; a kicker's or a defense's, which has no page, opens his club. */
@Composable
fun AdpRowView(
    row: AdpRow,
    gap: Boolean,
    actions: ReferenceActions,
) {
    val c = CommishTheme.colors
    val widths = adpWidths()
    val drawn = row.row
    val tap =
        drawn.sheetPlayer?.let { player -> Modifier.clickable { actions.open(player) } }
            ?: Modifier.clickable(enabled = drawn.club != Words.Figure.freeAgentClub) { actions.club(drawn.club) }
    Column(Modifier.fillMaxWidth().background(c.surface).then(tap)) {
        Row(
            Modifier.fillMaxWidth().heightIn(min = widths.row).padding(horizontal = Tokens.Space.s2.dp, vertical = 6.dp),
            horizontalArrangement = Arrangement.spacedBy(widths.spacing),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            RowFigure(row.adp, Modifier.width(widths.adp), ink = c.ink)
            Headshot(drawn.headshot, drawn.initials, widths.face, club = drawn.club.takeIf { drawn.clubMark })
            RowWho(drawn, actions::club, Modifier.weight(1f), wraps = false)
            RowFigure(drawn.projected, Modifier.width(widths.projected), ink = c.ink)
            val tint = roundTint(drawn.heat)
            RowFigure(
                drawn.overReplacement,
                Modifier.width(widths.overReplacement).then(tint?.let { Modifier.tintTile(it, widths.spacing) } ?: Modifier),
            )
            if (gap) RowFigure(drawn.gap, Modifier.width(widths.gap), ink = gapInk(drawn.gapTone))
        }
        HorizontalDivider(color = c.line)
    }
}

/** A format chip row (hidden when the run carries one format), the pressed chip the member's newest. */
@Composable
fun FormatChips(
    chips: List<BoardChip<String>>,
    choose: (String) -> Unit,
    still: Boolean,
) {
    if (chips.size <= 1) return
    Box(Modifier.padding(horizontal = Tokens.Space.s3.dp)) {
        ChipRow(chips.map { it.label to it.value }, chips.firstOrNull { it.pressed }?.value ?: chips.first().value, choose, still = still)
    }
}

/**
 * ADP as its model says it, top to bottom in the web's order at 390: the heading and stamp, the format
 * chips, the rows in the drafters' order, the basis. `still` draws it whole with no scrolling (a
 * snapshot's, over the rows it is given); else a lazy list.
 */
@Composable
fun AdpScreen(
    model: AdpModel,
    stale: String?,
    formats: List<BoardChip<String>>,
    actions: AdpActions,
    rows: List<AdpRow> = model.rows,
    still: Boolean = false,
) {
    val top: @Composable () -> Unit = {
        Column(Modifier.padding(top = Tokens.Space.s4.dp), verticalArrangement = Arrangement.spacedBy(Tokens.Space.s4.dp)) {
            ReferenceHead(model.heading, model.stamp, stale = stale)
            FormatChips(formats, actions.format, still)
        }
    }
    val foot: @Composable () -> Unit = { BasisLines(model.basis, Modifier.padding(vertical = Tokens.Space.s4.dp)) }
    if (still) {
        Column(Modifier.background(CommishTheme.colors.bg)) {
            top()
            AdpHeadRow(model)
            rows.forEach { AdpRowView(it, model.gap, actions.reference) }
            foot()
        }
        return
    }
    LazyColumn(Modifier.fillMaxSize()) {
        item("top") { top() }
        item("heads") { AdpHeadRow(model) }
        items(rows, key = { it.id }) { AdpRowView(it, model.gap, actions.reference) }
        item("basis") { foot() }
    }
}
