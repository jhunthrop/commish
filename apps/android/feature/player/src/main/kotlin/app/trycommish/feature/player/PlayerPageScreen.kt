package app.trycommish.feature.player

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.trycommish.core.player.CardVerb
import app.trycommish.core.player.PageState
import app.trycommish.core.player.PlayerPageModel
import app.trycommish.core.player.ReadFigure
import app.trycommish.core.player.SheetRead
import app.trycommish.core.player.UnwrittenLine
import app.trycommish.design.CommishTheme
import app.trycommish.design.Faces
import app.trycommish.design.Headshot
import app.trycommish.design.NumWeight
import app.trycommish.design.PositionPill
import app.trycommish.design.Tokens
import app.trycommish.design.Verb
import app.trycommish.design.Words

/** His face's side in the page's head. */
private const val HERO_FACE = 72

/** The capsule's sizes (Capsule.svelte): its lead paragraph's, its body's (--t-read), and its leading. */
private const val READ_LEAD = 22.0
private const val READ_BODY = 19.0
private const val READ_LEADING = 1.4

/** The page at its state: a pull reads again; the verb pinned above the bar where the app can follow it
 * (`act` returns null where it cannot, and the page then pins none). */
@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
fun PlayerPageView(
    state: PageState,
    stamp: String?,
    refreshing: Boolean,
    refresh: () -> Unit,
    act: (CardVerb, String) -> (() -> Unit)?,
) {
    val c = CommishTheme.colors
    Column(Modifier.fillMaxSize().background(c.bg)) {
        PullToRefreshBox(refreshing, refresh, Modifier.weight(1f)) {
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
                when (state) {
                    PageState.Loading -> Unit
                    is PageState.Loaded -> PageSectionsView(state.model, stamp)
                    is PageState.Failed ->
                        Text(state.words, style = Faces.body, color = c.ink2, modifier = Modifier.padding(Tokens.Space.s5.dp))
                }
            }
        }
        val model = (state as? PageState.Loaded)?.model
        val verb = model?.verb
        val action = verb?.let { act(it, model.hero.name) }
        if (verb != null && action != null) PinnedVerb(verb, action)
    }
}

/** The page's sections, top to bottom, in the web's order. */
@Composable
fun PageSectionsView(
    model: PlayerPageModel,
    stamp: String?,
    modifier: Modifier = Modifier,
) {
    Column(modifier.fillMaxWidth().padding(Tokens.Space.s4.dp), verticalArrangement = Arrangement.spacedBy(Tokens.Space.s5.dp)) {
        Column(verticalArrangement = Arrangement.spacedBy(Tokens.Space.s3.dp)) {
            PageHero(model.hero, stamp)
            PlayerCardView(model.card, stamp = null)
            PageNotesView(model.notes, model.leagueLine)
        }
        model.facts?.let { PageFacts(it) }
        SeasonBlock(model.season)
        model.read?.let { PageRead(it) }
        val held = model.heldTier
        if (held != null) PanelTitle(held) else model.tier?.let { TierBoxView(it) }
        model.formats?.let { FormatsTableView(it) }
        BasisLines(model.basis + model.stamp)
    }
}

/** The page's head: his face, name, club, position pill and status. */
@Composable
fun PageHero(
    hero: PlayerPageModel.Hero,
    stamp: String?,
) {
    val c = CommishTheme.colors
    Column(verticalArrangement = Arrangement.spacedBy(Tokens.Space.s3.dp)) {
        stamp?.let { StampLine(it) }
        Row(horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s3.dp), verticalAlignment = Alignment.CenterVertically) {
            Headshot(hero.headshot, hero.initials, HERO_FACE.dp)
            Column(verticalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp)) {
                Text(
                    hero.name.uppercase(),
                    style = Faces.number(NumWeight.Bold, Tokens.Type.display.sp).copy(fontFeatureSettings = null),
                    color = c.ink,
                    modifier = Modifier.semantics { heading() },
                )
                Row(horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(hero.club, style = Faces.small.copy(fontWeight = FontWeight.Medium), color = c.ink2)
                    PositionPill(hero.pill)
                    hero.status?.let { StatusPill(it) }
                }
            }
        }
    }
}

/** The footnotes under the card and the league line (B165): his newest game's club, his status with the
 * capture it is from, and the figures' scoring against the selected league's. */
@Composable
private fun PageNotesView(
    notes: List<String>,
    leagueLine: String?,
) {
    val lines = notes + listOfNotNull(leagueLine)
    if (lines.isNotEmpty()) BasisLines(lines)
}

/** A section's title in the number face (PanelHead.svelte), its aside under it. */
@Composable
internal fun PanelTitle(
    title: String,
    aside: String? = null,
) {
    val c = CommishTheme.colors
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(
            title.uppercase(),
            style = Faces.number(NumWeight.Bold, Tokens.Type.xl.sp).copy(fontFeatureSettings = null),
            color = c.ink,
            modifier = Modifier.semantics { heading() },
        )
        aside?.let { Text(it, style = Faces.small, color = c.ink3) }
    }
}

/** Our read on his page: in season the week's read as the shelf prints it; before the season the writer's
 * capsule in the reading face, its stamp in the face's caption, its figures beside it, or the words for a
 * read not ready with what it will be built from. */
@Composable
fun PageRead(read: PlayerPageModel.Read) {
    when (read) {
        is PlayerPageModel.Read.Week -> WeekReadView(SheetRead.Shown(read.shown))
        is PlayerPageModel.Read.WeekNone -> WeekReadView(SheetRead.None(read.words))
        is PlayerPageModel.Read.Unwritten -> UnwrittenRead(read.words, read.lines)
        is PlayerPageModel.Read.Prose -> ProseRead(read)
    }
}

@Composable
private fun UnwrittenRead(
    words: String,
    lines: List<UnwrittenLine>,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp)) {
        SmallHead(Words.Card.ourRead, Modifier.semantics { heading() })
        Text(words, style = Faces.body, color = CommishTheme.colors.ink2)
        lines.forEach { UnwrittenRow(it) }
    }
}

/** A fact the read will be built from (LineList.svelte): its lead and figure over its sentence. */
@Composable
private fun UnwrittenRow(line: UnwrittenLine) {
    val c = CommishTheme.colors
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        HorizontalDivider(color = c.line)
        Row(Modifier.fillMaxWidth().padding(top = Tokens.Space.s2.dp), verticalAlignment = Alignment.Bottom) {
            SmallHead(line.lead, Modifier.weight(1f))
            Text(line.figure, style = Faces.number(NumWeight.Bold), color = c.ink)
        }
        Text(line.text, style = Faces.small, color = c.ink2)
    }
}

@Composable
private fun ProseRead(read: PlayerPageModel.Read.Prose) {
    val c = CommishTheme.colors
    Column(verticalArrangement = Arrangement.spacedBy(Tokens.Space.s3.dp)) {
        SmallHead(Words.Card.ourRead, Modifier.semantics { heading() })
        read.byline?.let {
            Text(it, style = Faces.basis.copy(fontStyle = FontStyle.Italic), color = c.ink3)
        }
        read.paragraphs.forEachIndexed { index, paragraph ->
            val size = if (index == 0) READ_LEAD else READ_BODY
            Text(
                paragraph,
                style = Faces.basis.copy(fontSize = size.sp, lineHeight = (size * READ_LEADING).sp),
                color = c.ink,
            )
            if (index == 0 && read.figures.isNotEmpty()) ReadFiguresRow(read.figures)
        }
    }
}

/** The figures set beside the capsule after its first paragraph, each naming its basis where it has one. */
@Composable
private fun ReadFiguresRow(figures: List<ReadFigure>) {
    val c = CommishTheme.colors
    Column {
        HorizontalDivider(color = c.line)
        Row(Modifier.padding(vertical = Tokens.Space.s3.dp), horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s4.dp)) {
            figures.forEach { figure ->
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Tokens.Space.s1.dp)) {
                    figure.label?.let { SmallHead(it) }
                    Text(
                        figure.figure,
                        style = Faces.basis.copy(fontSize = Tokens.Type.xl.sp, fontWeight = FontWeight.Medium),
                        color = c.ink,
                    )
                    Text(figure.caption, style = Faces.basis.copy(fontStyle = FontStyle.Italic), color = c.ink2)
                }
            }
        }
        HorizontalDivider(color = c.line)
    }
}

/** The league's one verb pinned above the bar, the line under it where it has one. */
@Composable
fun PinnedVerb(
    verb: CardVerb,
    action: () -> Unit,
) {
    val c = CommishTheme.colors
    Column(
        Modifier.fillMaxWidth().background(c.bg),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Tokens.Space.s1.dp),
    ) {
        HorizontalDivider(color = c.line)
        Verb(verb.label, Modifier.padding(horizontal = Tokens.Space.s4.dp, vertical = Tokens.Space.s1.dp), onClick = action)
        verb.note?.let {
            Text(
                it,
                style = Faces.label.copy(fontWeight = FontWeight.Normal),
                color = c.ink3,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(horizontal = Tokens.Space.s4.dp).padding(bottom = Tokens.Space.s2.dp),
            )
        }
    }
}
