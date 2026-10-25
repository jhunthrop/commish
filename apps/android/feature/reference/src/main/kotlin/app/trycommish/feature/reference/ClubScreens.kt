package app.trycommish.feature.reference

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.trycommish.core.board.BoardColumns
import app.trycommish.core.reference.ClubCard
import app.trycommish.core.reference.ClubPageModel
import app.trycommish.core.reference.ClubsModel
import app.trycommish.core.shell.SiteLinks
import app.trycommish.design.CommishTheme
import app.trycommish.design.Faces
import app.trycommish.design.Headshot
import app.trycommish.design.NumWeight
import app.trycommish.design.PositionPill
import app.trycommish.design.QuietButton
import app.trycommish.design.Tokens
import app.trycommish.design.resolve
import app.trycommish.feature.board.BoardHeadRow
import app.trycommish.feature.board.BoardRowView
import app.trycommish.feature.board.BoardSectionHead
import app.trycommish.feature.board.SmallCaps

private val GAME_WEEK = 64.dp
private val GAME_VALUE = 72.dp
private val GAME_ROW = 40.dp

/** A strength figure in the number face with its caption under it (Figure.svelte). */
@Composable
fun StrengthFigureView(
    value: String,
    caption: String,
    note: String? = null,
    size: TextUnit = Tokens.Type.xl.sp,
    modifier: Modifier = Modifier,
) {
    val c = CommishTheme.colors
    Column(modifier) {
        Text(value, style = Faces.number(NumWeight.Bold, size), color = c.ink)
        Text(caption, style = Faces.label, color = c.ink2)
        note?.let { Text(it, style = Faces.label.copy(fontWeight = FontWeight.Normal), color = c.ink3) }
    }
}

/** A club's card on the index (Tile.svelte): its name and line opening its page, its strength, its lead
 * player opening his sheet, and how many of its players our board ranks. */
@Composable
fun ClubCardView(
    card: ClubCard,
    actions: ReferenceActions,
) {
    val c = CommishTheme.colors
    val shape = RoundedCornerShape(Tokens.Radius.md.dp)
    Column(
        Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(c.surface)
            .border(1.dp, c.line, shape)
            .padding(Tokens.Space.s3.dp),
        verticalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp),
    ) {
        Column(Modifier.fillMaxWidth().clickable(role = Role.Button) { actions.club(card.abbr) }) {
            Text(card.name, style = Faces.section.copy(fontWeight = FontWeight.Bold), color = c.ink)
            SmallCaps(card.meta)
        }
        card.strength?.let { StrengthFigureView(it.value, it.caption, size = Tokens.Type.lg.sp) }
        card.lead?.let { lead ->
            Row(
                Modifier.fillMaxWidth().clickable(role = Role.Button) { actions.open(lead.sheetPlayer) },
                horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Headshot(lead.headshot, lead.initials, 28.dp)
                Text(lead.name, style = Faces.body.copy(fontWeight = FontWeight.SemiBold), color = c.ink)
                PositionPill(lead.pill)
                Spacer(Modifier.weight(1f))
                SmallCaps(lead.rank)
            }
        }
        SmallCaps(card.players)
    }
}

/** The clubs index at 390: the heading, its lead, the link to the schedule, every club's card. `still`
 * draws the cards it is given whole (a snapshot's); else a lazy list. */
@Composable
fun ClubsScreen(
    model: ClubsModel,
    stale: String?,
    actions: ReferenceActions,
    clubs: List<ClubCard> = model.clubs,
    still: Boolean = false,
) {
    val top: @Composable () -> Unit = {
        Column(Modifier.padding(top = Tokens.Space.s4.dp)) {
            ReferenceHead(model.title, model.stamp, model.lead, stale)
            QuietButton(model.scheduleLink, Modifier.padding(horizontal = Tokens.Space.s1.dp)) { actions.link(SiteLinks.SCHEDULE) }
        }
    }
    val card: @Composable (ClubCard) -> Unit = {
        Column(Modifier.padding(horizontal = Tokens.Space.s3.dp, vertical = Tokens.Space.s2.dp)) { ClubCardView(it, actions) }
    }
    if (still) {
        Column(Modifier.background(CommishTheme.colors.bg)) {
            top()
            clubs.forEach { card(it) }
        }
        return
    }
    LazyColumn(Modifier.fillMaxSize()) {
        item("top") { top() }
        items(clubs, key = { it.abbr }) { card(it) }
        item("foot") { Column(Modifier.padding(bottom = Tokens.Space.s4.dp)) {} }
    }
}

/** A club's hero (HeroCard.svelte at 390): the way back to the clubs, its name and line, its strength with
 * its read and its rank. */
@Composable
private fun ClubHeroView(
    model: ClubPageModel,
    stale: String?,
    actions: ReferenceActions,
) {
    val c = CommishTheme.colors
    Column(verticalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp)) {
        QuietButton(model.clubsLink, Modifier.padding(horizontal = Tokens.Space.s1.dp)) { actions.link(SiteLinks.CLUBS) }
        ReferenceHead(model.name, model.stamp, model.meta, stale)
        model.hero?.let { hero ->
            Row(
                Modifier
                    .padding(horizontal = Tokens.Space.s3.dp)
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(Tokens.Radius.md.dp))
                    .background(c.surface)
                    .padding(Tokens.Space.s3.dp),
                horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s5.dp),
            ) {
                StrengthFigureView(hero.value, hero.caption, hero.note, size = Tokens.Type.display.sp)
                StrengthFigureView(hero.hardest, hero.hardestCaption, size = Tokens.Type.head.sp)
            }
        }
    }
}

/** A club's schedule (Table.svelte with its caption): Week, the opponent at or against opening his page,
 * his expected wins; a game played set back. */
@Composable
private fun ClubScheduleView(
    model: ClubPageModel,
    actions: ReferenceActions,
) {
    val c = CommishTheme.colors
    val shape = RoundedCornerShape(Tokens.Radius.md.dp)
    Column(verticalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp)) {
        Text(model.scheduleCaption, style = Faces.small, color = c.ink3, modifier = Modifier.padding(horizontal = Tokens.Space.s3.dp))
        Column(
            Modifier
                .padding(horizontal = Tokens.Space.s3.dp)
                .clip(shape)
                .background(c.surface)
                .border(1.dp, c.line, shape),
        ) {
            Row(
                Modifier.fillMaxWidth().heightIn(min = 34.dp).padding(horizontal = Tokens.Space.s3.dp),
                horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                ColumnHead(model.scheduleHeads[0], Modifier.width(GAME_WEEK), TextAlign.Start)
                ColumnHead(model.scheduleHeads[1], Modifier.weight(1f), TextAlign.Start)
                ColumnHead(model.scheduleHeads[2], Modifier.width(GAME_VALUE))
            }
            HorizontalDivider(color = c.line)
            model.games.forEach { game ->
                val color = if (game.played) Tokens.Color.playedInk.resolve(c.dark) else c.ink
                val style = Faces.small.copy(fontWeight = FontWeight.Medium)
                Row(
                    Modifier.fillMaxWidth().heightIn(min = GAME_ROW).padding(horizontal = Tokens.Space.s3.dp),
                    horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(game.weekWords, style = style, color = color, modifier = Modifier.width(GAME_WEEK))
                    Text(
                        game.opponent,
                        style = style,
                        color = color,
                        modifier = Modifier.weight(1f).clickable(role = Role.Button) { actions.club(game.club) },
                    )
                    Text(game.value, style = style, color = color, textAlign = TextAlign.End, modifier = Modifier.width(GAME_VALUE))
                }
                HorizontalDivider(color = c.line)
            }
        }
    }
}

/** A club's page at 390 in the web's order: the hero, the basis, its players on our board in the board's
 * order, its kickers and defense, its schedule. `still` draws it whole with no scrolling (a snapshot's). */
@Composable
fun ClubScreen(
    model: ClubPageModel,
    stale: String?,
    actions: ReferenceActions,
    still: Boolean = false,
) {
    val c = CommishTheme.colors
    val scroll = if (still) Modifier else Modifier.fillMaxSize().verticalScroll(rememberScrollState())
    Column(scroll.background(c.bg).padding(vertical = Tokens.Space.s4.dp), verticalArrangement = Arrangement.spacedBy(Tokens.Space.s4.dp)) {
        ClubHeroView(model, stale, actions)
        BasisLines(model.basis)
        Column {
            BoardSectionHead(model.boardHead)
            val nobody = model.nobody
            if (nobody != null) {
                Text(nobody, style = Faces.small, color = c.ink3, modifier = Modifier.padding(Tokens.Space.s3.dp))
            } else {
                BoardHeadRow(model.columns)
                // No club chip link here: the page is that club's own (review L2).
                model.rows.forEach { BoardRowView(it, model.columns, open = actions.open) }
            }
        }
        if (model.market.isNotEmpty()) {
            Column {
                BoardSectionHead(model.marketHead)
                BoardHeadRow(BoardColumns.DraftOrder)
                model.market.forEach { BoardRowView(it, BoardColumns.DraftOrder, open = actions.open) }
            }
        }
        ClubScheduleView(model, actions)
    }
}
