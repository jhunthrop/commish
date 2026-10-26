package app.trycommish.feature.companion

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.wrapContentWidth
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.trycommish.core.board.Heat
import app.trycommish.core.companion.PickStripModel
import app.trycommish.core.companion.RoomPlayer
import app.trycommish.core.shell.SheetPlayer
import app.trycommish.design.CommishTheme
import app.trycommish.design.Faces
import app.trycommish.design.Headshot
import app.trycommish.design.NumWeight
import app.trycommish.design.PositionPill
import app.trycommish.design.Tokens
import app.trycommish.feature.board.SmallCaps
import app.trycommish.feature.board.roundTint
import app.trycommish.feature.board.tintTile
import app.trycommish.feature.boxscore.FitText

/** The companion's widths at 390 (the room's phone grid, Pool.svelte --pool-cols), the iOS CompanionColumn:
 * his face, the player taking the rest, Over repl, the chance, a team's slot and its pick. */
object Widths {
    val face = 32.dp
    val value = 64.dp
    val chance = 78.dp
    val slot = 44.dp
    val pick = 44.dp
    val gap = 6.dp
    val stripLead = 92.dp
    val stripFace = 64.dp
    val stripHead = 36.dp
}

private val HAIRLINE = 1.dp
private val EDGE = 2.dp
private val METER = 4.dp

/** What the screen's controls do: a row opens the player sheet, the verb and the bar's link open the
 * platform's draft room, a chip chooses, another draft is followed from the start page. */
class CompanionActions(
    val open: (SheetPlayer) -> Unit = {},
    val openDraft: () -> Unit = {},
    val filter: (String) -> Unit = {},
    val followAnother: () -> Unit = {},
    val more: () -> Unit = {},
)

/** A panel's line (Panel.svelte): the hairline, the accent's edge at your turn, the loss's edge. */
enum class Edge { Plain, Accent, Quiet, Loss }

/** A panel as the web draws one (Panel.svelte): the surface, its line, the accent or the loss edge. */
@Composable
fun Panel(
    edge: Edge = Edge.Plain,
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    val c = CommishTheme.colors
    val shape = RoundedCornerShape(Tokens.Radius.md.dp)
    val line =
        when (edge) {
            Edge.Plain, Edge.Quiet -> c.line
            Edge.Accent -> c.accent
            Edge.Loss -> c.lossInk
        }
    Column(
        modifier
            .padding(horizontal = Tokens.Space.s3.dp)
            .fillMaxWidth()
            .background(c.surface, shape)
            .border(if (edge == Edge.Plain || edge == Edge.Quiet) HAIRLINE else EDGE, line, shape)
            .padding(Tokens.Space.s3.dp),
        content = content,
    )
}

/** A line of the small words under a head: ink 2, the small face. */
@Composable
fun NoteText(
    text: String,
    modifier: Modifier = Modifier,
    ink: Color = CommishTheme.colors.ink2,
) {
    Text(text, style = Faces.small, color = ink, modifier = modifier.fillMaxWidth())
}

/** A column head in the room's small caps (Label.svelte), shrunk rather than broken. */
@Composable
fun HeadText(
    text: String,
    modifier: Modifier = Modifier,
    end: Boolean = true,
    lines: Int = 2,
) {
    FitText(
        text.uppercase(),
        style = Faces.label,
        color = CommishTheme.colors.ink3,
        maxLines = lines,
        textAlign = if (end) TextAlign.End else TextAlign.Start,
        modifier = modifier,
    )
}

/** A figure cell in the number face, right aligned, shrunk to fit its width. */
@Composable
fun FigureText(
    text: String,
    width: Dp,
    ink: Color = CommishTheme.colors.ink,
    style: TextStyle = Faces.cell,
) {
    FitText(text, style = style, color = ink, textAlign = TextAlign.End, modifier = Modifier.width(width))
}

/** A player's face: his headshot, his initials while it loads or where he has none. */
@Composable
fun PlayerFace(
    player: RoomPlayer,
    side: Dp = Widths.face,
) {
    Headshot(player.headshot.takeIf { it.isNotEmpty() }, player.initials, side, club = player.clubMark)
}

/** His name the biggest thing in the row, his pill and club under it, and an extra word after them. */
@Composable
fun WhoCell(
    player: RoomPlayer,
    modifier: Modifier = Modifier,
    extra: String? = null,
    strong: Boolean = false,
) {
    val c = CommishTheme.colors
    Column(modifier, verticalArrangement = Arrangement.spacedBy(3.dp)) {
        Text(player.name, style = Faces.body.copy(fontWeight = FontWeight.SemiBold), color = c.ink, maxLines = 2)
        Row(horizontalArrangement = Arrangement.spacedBy(Widths.gap), verticalAlignment = Alignment.CenterVertically) {
            PositionPill(if (player.positionRank > 0) player.pill else player.position)
            SmallCaps(player.team)
            extra?.let {
                Text(
                    it,
                    style = Faces.label.copy(letterSpacing = 0.sp, fontWeight = if (strong) FontWeight.SemiBold else FontWeight.Normal),
                    color = if (strong) c.ink else c.ink3,
                    maxLines = 1,
                )
            }
        }
    }
}

/** A row a tap opens his sheet from: the button's role, the hairline over it. */
fun Modifier.opens(
    player: RoomPlayer?,
    open: (SheetPlayer) -> Unit,
): Modifier = player?.let { clickable(role = Role.Button, onClickLabel = it.name) { open(it.sheetPlayer) } } ?: this

/** A strip of picks (PickStrip.svelte): the lead figure and its lines, then each face with his last name
 * and its lines, the newest ringed in ink (with `ringStrong`, the mock's SinceStrip, a strong face ringed in
 * the accent: a pick that was in your queue); sideways where it runs past the phone, still in a snapshot. */
@Composable
fun PickStripView(
    strip: PickStripModel,
    open: (SheetPlayer) -> Unit,
    still: Boolean,
    ringStrong: Boolean = false,
) {
    val c = CommishTheme.colors
    Panel {
        Row(horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s3.dp)) {
            Column(Modifier.width(Widths.stripLead), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(strip.lead, style = Faces.figure, color = c.ink)
                strip.lines.forEach {
                    Text(
                        it,
                        style = Faces.label.copy(fontWeight = FontWeight.Normal, letterSpacing = 0.sp),
                        color = c.ink3,
                    )
                }
            }
            val scroll =
                if (still) {
                    Modifier.wrapContentWidth(
                        Alignment.Start,
                        unbounded = true,
                    )
                } else {
                    Modifier.horizontalScroll(rememberScrollState())
                }
            Box(Modifier.weight(1f).clipToBounds()) {
                Row(scroll, horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp)) {
                    strip.picks.forEach { face ->
                        Column(
                            Modifier.width(Widths.stripFace).opens(face.player, open),
                            horizontalAlignment = Alignment.CenterHorizontally,
                        ) {
                            val ring =
                                when {
                                    face.newest -> Modifier.border(EDGE, c.ink, CircleShape)
                                    ringStrong && face.strong -> Modifier.border(EDGE, c.accent, CircleShape)
                                    else -> Modifier
                                }
                            Box(ring) { PlayerFace(face.player, Widths.stripHead) }
                            Text(
                                face.name,
                                style = Faces.label.copy(letterSpacing = 0.sp),
                                color = c.ink,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                            face.lines.forEachIndexed { index, line ->
                                val strong = index > 0 && face.strong
                                Text(
                                    line,
                                    style =
                                        Faces.label.copy(
                                            letterSpacing = 0.sp,
                                            fontWeight = if (strong) FontWeight.SemiBold else FontWeight.Normal,
                                        ),
                                    color = if (strong) c.ink else c.ink3,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

/** A chance as the room's cell prints it (StillThereCell.svelte): the figure, its meter, what it is of; or
 * the words for none. */
@Composable
fun ChanceCell(
    chance: String?,
    label: String,
    missing: String,
) {
    val c = CommishTheme.colors
    Column(Modifier.width(Widths.chance), horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(2.dp)) {
        if (chance == null) {
            Text(missing, style = Faces.label.copy(fontWeight = FontWeight.Normal, letterSpacing = 0.sp), color = c.ink3)
            return@Column
        }
        Text(chance, style = Faces.number(NumWeight.Bold), color = c.ink)
        Canvas(Modifier.fillMaxWidth().height(METER)) {
            val round = CornerRadius(size.height / 2)
            drawRoundRect(c.surface2, cornerRadius = round)
            drawRoundRect(c.accent, size = Size(size.width * share(chance), size.height), cornerRadius = round)
        }
        Text(
            label,
            style = Faces.label.copy(fontWeight = FontWeight.Normal, letterSpacing = 0.sp),
            color = c.ink3,
            textAlign = TextAlign.End,
            maxLines = 2,
        )
    }
}

/** The meter's share from the printed chance: "<1%" is 0, ">99%" is 1. */
fun share(chance: String): Float =
    when {
        chance.startsWith("<") -> 0f
        chance.startsWith(">") -> 1f
        else -> (chance.removeSuffix("%").toFloatOrNull() ?: 0f) / PERCENT
    }

private const val PERCENT = 100f

/** Over repl on its round's tint (Row.svelte .heat-1 to .heat-4, .heat-neg), the Board's tile. */
@Composable
fun ValueCell(
    text: String,
    heat: Heat?,
) {
    val c = CommishTheme.colors
    val tile = heat?.let { roundTint(it) }
    Box(
        Modifier.width(Widths.value).then(
            tile?.let {
                Modifier.tintTile(it, Widths.gap)
            } ?: Modifier,
        ),
        contentAlignment = Alignment.CenterEnd,
    ) {
        if (heat == null) {
            Text(text, style = Faces.label.copy(letterSpacing = 0.sp), color = c.ink3, textAlign = TextAlign.End, maxLines = 2)
        } else {
            FitText(text, style = Faces.cell, color = c.ink2, textAlign = TextAlign.End)
        }
    }
}

/** A hairline across a list's row. */
@Composable
fun RowRule() {
    Box(Modifier.fillMaxWidth().height(HAIRLINE).background(CommishTheme.colors.line))
}

/** A section's head in the display face, its aside under it (SectionHead.svelte at 390). */
@Composable
fun SectionHead(
    title: String,
    aside: String? = null,
    modifier: Modifier = Modifier,
) {
    val c = CommishTheme.colors
    Column(modifier) {
        Text(title.uppercase(), style = Faces.head, color = c.ink)
        aside?.let { Text(it, style = Faces.small, color = c.ink2) }
    }
}
