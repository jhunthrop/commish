package app.trycommish.feature.mock

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.wrapContentWidth
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.trycommish.core.lobby.LobbyScoreBug
import app.trycommish.core.lobby.LobbySeatCell
import app.trycommish.core.lobby.LobbyWait
import app.trycommish.design.CommishTheme
import app.trycommish.design.Faces
import app.trycommish.design.NumWeight
import app.trycommish.design.QuietButton
import app.trycommish.design.Tokens
import app.trycommish.design.Verb
import app.trycommish.design.Words
import app.trycommish.feature.companion.NoteText
import app.trycommish.feature.companion.Panel

private val BUG_HEIGHT = 56.dp
private val BUG_CLOCK = 34.sp
private val SEAT_HEIGHT = 40.dp
private val SEAT_COMPACT = 32.dp
private val SEAT_MIN = 92.dp
private val SEAT_MAX = 160.dp
private val SEAT_GAP = 6.dp
private val SEAT_PAD = 8.dp
private val THIN = 1.dp
private val THICK = 2.dp

/**
 * The score bug (ScoreBug.svelte at 390), the iOS LobbyScoreBugView's: the round and the pick, who is on the
 * clock, the room's clock big, and your pick, on the scoreboard's dark. The ticking clock is hidden from a screen
 * reader, which hears it only at ten and five seconds on your own clock.
 */
@Composable
internal fun LobbyScoreBugView(bug: LobbyScoreBug) {
    val c = CommishTheme.colors
    val shape = RoundedCornerShape(Tokens.Radius.md.dp)
    Row(
        Modifier
            .padding(horizontal = Tokens.Space.s3.dp)
            .fillMaxWidth()
            .height(BUG_HEIGHT)
            .background(c.scoreboard, shape)
            .border(THIN, c.scoreboardLine, shape)
            .semantics(mergeDescendants = true) { if (bug.yours) stateDescription = Words.Lobby.yourPickIsNow },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        BugSegment(bug.round, bug.pick)
        BugDivider()
        BugSegment(Words.Lobby.onTheClock, bug.onClock, Modifier.weight(1f))
        BugDivider()
        Column(
            Modifier.padding(horizontal = Tokens.Space.s2.dp).clearAndSetSemantics {},
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            BugLabel(Words.Lobby.clock)
            Text(bug.clock, style = Faces.number(NumWeight.Bold, BUG_CLOCK), color = c.scoreboardNum, maxLines = 1)
        }
        BugDivider()
        BugSegment(Words.Lobby.yourPick, bug.yourPick, num = true)
    }
    bug.spoken?.let { spoken ->
        Box(
            Modifier.size(1.dp).semantics {
                liveRegion = LiveRegionMode.Assertive
                contentDescription = spoken
            },
        )
    }
}

@Composable
private fun BugSegment(
    small: String,
    big: String,
    modifier: Modifier = Modifier,
    num: Boolean = false,
) {
    val c = CommishTheme.colors
    Column(modifier.padding(horizontal = Tokens.Space.s2.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
        BugLabel(small)
        Text(
            big,
            style = Faces.number(NumWeight.Bold),
            color = if (num) c.scoreboardNum else c.scoreboardInk,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun BugLabel(text: String) {
    Text(text.uppercase(), style = Faces.label, color = CommishTheme.colors.scoreboardInk2, maxLines = 1)
}

@Composable
private fun BugDivider() {
    Box(Modifier.width(THIN).fillMaxHeight().background(CommishTheme.colors.scoreboardLine))
}

/**
 * The seats strip (SeatsStrip.svelte), the iOS LobbySeatsView's: a person's seat names him and says how he is, a
 * bot's or an open seat a compact cell with its number; yours and the seat on the clock edged, scrolled into view.
 * `still` lays it at rest, showing its end when your seat is in its later half, as the live strip scrolls to it.
 */
@Composable
internal fun LobbySeatsView(
    seats: List<LobbySeatCell>,
    still: Boolean,
) {
    val scroll = rememberScrollState()
    val yours = seats.indexOfFirst { it.you }.coerceAtLeast(0)
    val clock = seats.indexOfFirst { it.onClock }
    // Your seat always in view, followed as the clock moves (the strip's scroll at its share of the seats).
    LaunchedEffect(clock, yours, scroll.maxValue) {
        if (scroll.maxValue > 0) scroll.animateScrollTo(scroll.maxValue * yours / maxOf(seats.size - 1, 1))
    }
    val row = @Composable { mod: Modifier ->
        Row(
            mod.padding(horizontal = Tokens.Space.s3.dp, vertical = 2.dp),
            horizontalArrangement = Arrangement.spacedBy(SEAT_GAP),
        ) {
            seats.forEach { SeatCell(it) }
        }
    }
    val label = Modifier.semantics { contentDescription = Words.Lobby.seats }
    if (still) {
        Box(
            label.fillMaxWidth().clipToBounds(),
            contentAlignment = if (yours * 2 >= seats.size) Alignment.CenterEnd else Alignment.CenterStart,
        ) { row(Modifier.wrapContentWidth(unbounded = true, align = if (yours * 2 >= seats.size) Alignment.End else Alignment.Start)) }
    } else {
        row(label.fillMaxWidth().horizontalScroll(scroll))
    }
}

@Composable
private fun SeatCell(seat: LobbySeatCell) {
    val c = CommishTheme.colors
    val shape = RoundedCornerShape(Tokens.Radius.sm.dp)
    val edge =
        when {
            seat.onClock -> c.accent
            seat.you -> c.ink
            else -> c.line
        }
    val ground =
        Modifier
            .heightIn(min = SEAT_HEIGHT)
            .background(if (seat.onClock) c.accentWash else c.surface, shape)
            .border(if (seat.onClock || seat.you) THICK else THIN, edge, shape)
    if (seat.compact) {
        Box(ground.width(SEAT_COMPACT).semantics { contentDescription = seat.label }, contentAlignment = Alignment.Center) {
            Text(seat.id.toString(), style = Faces.number(NumWeight.Bold, Tokens.Type.sm.sp), color = if (seat.open) c.ink3 else c.ink2)
        }
    } else {
        Column(
            ground
                .widthIn(
                    min = SEAT_MIN,
                    max = SEAT_MAX,
                ).padding(horizontal = SEAT_PAD, vertical = 3.dp)
                .semantics(mergeDescendants = true) {},
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            Text(
                seat.name,
                style = Faces.small.copy(fontWeight = FontWeight.Bold),
                color = if (seat.left) c.ink3 else c.ink,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                seat.line,
                style = Faces.label.copy(fontWeight = FontWeight.Normal),
                color = if (seat.onClock) c.accentText else c.ink3,
                maxLines = 1,
            )
        }
    }
}

/** The filling room's line (LobbyRoomView.svelte .wait): the count in bold, then when it starts. */
@Composable
internal fun LobbyWaitView(wait: LobbyWait) = LeadLine(wait.count, " ${wait.words}")

/** The dock's line (LobbyRoomView.svelte .about): the lobby in bold, then who is in it and its clock. */
@Composable
internal fun LobbyAboutView(
    head: String,
    about: String,
) = LeadLine(head, ", $about")

@Composable
private fun LeadLine(
    lead: String,
    rest: String,
) {
    val c = CommishTheme.colors
    Panel {
        Text(
            buildAnnotatedString {
                withStyle(Faces.small.toSpanStyle().copy(color = c.ink, fontWeight = FontWeight.Bold)) { append(lead) }
                withStyle(Faces.small.toSpanStyle().copy(color = c.ink2)) { append(rest) }
            },
            style = Faces.small,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

/** A notice over the room (the room page's .notice panels): a line, and the way forward when there is one. */
@Composable
internal fun LobbyNoticeView(
    line: String,
    verb: Pair<String, () -> Unit>? = null,
) {
    Panel {
        Column(verticalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp)) {
            NoteText(line)
            verb?.let { (label, act) -> Verb(label, onClick = act) }
        }
    }
}

/** A notice's quiet way back (a room that cannot be read): the line and the quiet verb. */
@Composable
internal fun LobbyQuietNotice(
    line: String,
    verb: String,
    act: () -> Unit,
) {
    Panel {
        Column(verticalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp)) {
            NoteText(line)
            QuietButton(verb, onClick = act)
        }
    }
}
