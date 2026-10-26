package app.trycommish.feature.mock

import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import app.trycommish.core.AppWords
import app.trycommish.core.companion.PoolModel
import app.trycommish.core.mock.MockBar
import app.trycommish.core.mock.MockRoomModel
import app.trycommish.core.shell.SheetPlayer
import app.trycommish.design.CommishTheme
import app.trycommish.design.Faces
import app.trycommish.design.QuietButton
import app.trycommish.design.R
import app.trycommish.design.Tokens
import app.trycommish.design.Words
import app.trycommish.feature.companion.NoteText
import app.trycommish.feature.companion.Panel
import app.trycommish.feature.companion.PickStripView
import app.trycommish.feature.companion.TeamView
import app.trycommish.feature.companion.WallView

/** What the room's controls do: the bar's verbs, a pool row's mark, queue and draft, a chip, the call's one
 * verb, more rows, and a face on the wall or the team opening the player sheet. */
class MockRoomActions(
    val draft: (String?) -> Unit = {},
    val undo: () -> Unit = {},
    val autopick: () -> Unit = {},
    val finish: () -> Unit = {},
    val share: () -> Unit = {},
    val queue: (String) -> Unit = {},
    val mark: (String) -> Unit = {},
    val filter: (String) -> Unit = {},
    val more: () -> Unit = {},
    val open: (SheetPlayer) -> Unit = {},
)

/** A part of the room, so a snapshot can frame the one it is of. */
enum class MockRoomPart { Call, Pool, Wall, Team }

/**
 * The room as its model says it, in the web's order at 390 (SoloRoom.svelte), the approved iOS screen's: a
 * shared draft's head, the saved room's line, a refusal, the undo's line, the strip since your pick, our call,
 * the pool, the wall and your team. Pure of state, so a snapshot draws it from the fixture; `still` lays the
 * strips, chips and wall at rest.
 */
@Composable
fun MockRoom(
    model: MockRoomModel,
    stale: String?,
    refusal: String?,
    enabled: Boolean,
    actions: MockRoomActions,
    modifier: Modifier = Modifier,
    shown: Int = PoolModel.FIRST_ROWS,
    still: Boolean = false,
    parts: Set<MockRoomPart> = MockRoomPart.entries.toSet(),
    shared: SharedVerb? = null,
) {
    Column(modifier.padding(vertical = Tokens.Space.s4.dp), verticalArrangement = Arrangement.spacedBy(Tokens.Space.s4.dp)) {
        model.shared?.let { head -> MockSharedHeadView(head, shared?.starting == true, shared?.run ?: {}) }
        listOfNotNull(stale, refusal, model.notice).forEach { line -> Panel { NoteText(line) } }
        if (MockRoomPart.Call in parts) {
            model.straight?.let { Panel { NoteText(it) } }
            model.since?.let { PickStripView(it, actions.open, still, ringStrong = true) }
            model.call?.let { MockCallView(it, enabled, actions.draft) }
        }
        if (MockRoomPart.Pool in parts) model.pool?.let { MockPoolView(it, shown, enabled, actions, still) }
        if (MockRoomPart.Wall in parts) WallView(model.wall, actions.open, still)
        if (MockRoomPart.Team in parts) TeamView(model.team, actions.open, model.teamTitle)
    }
}

/** A shared draft's one verb: running it, and whether its start is on its way. */
class SharedVerb(
    val starting: Boolean,
    val run: () -> Unit,
)

/**
 * The web's SoloBar as the room's bottom bar: the pick on the clock, big, and the league's cells under it,
 * wrapping as the web's flex-wrap does (so your next pick is never cut off); Undo, and More holding Pick for me, Finish the draft and Save and share (the phone's fold).
 * `still` draws More's face without its menu.
 */
@Composable
fun MockBarView(
    bar: MockBar,
    enabled: Boolean,
    copied: Boolean,
    actions: MockRoomActions,
    still: Boolean = false,
) {
    val c = CommishTheme.colors
    Column(
        Modifier
            .fillMaxWidth()
            .drawBehind { drawRect(c.line, Offset.Zero, Size(size.width, 1.dp.toPx())) }
            .padding(horizontal = Tokens.Space.s3.dp, vertical = Tokens.Space.s2.dp),
        verticalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp),
    ) {
        Text(
            bar.head.uppercase(),
            style = Faces.head,
            color = c.ink,
            maxLines = 1,
            modifier = Modifier.semantics { heading() },
        )
        Cells(bar.cells, spacing = Tokens.Space.s3)
        Row(verticalAlignment = Alignment.CenterVertically) {
            QuietButton(Words.Mock.undo, enabled = enabled && bar.undoPick != null, onClick = actions.undo)
            Spacer(Modifier.weight(1f))
            MoreMenu(bar, enabled, copied, actions, still)
        }
    }
}

/** More's face, the phone's fold of the bar's other verbs (or "Link copied" for a moment), and its menu. */
@Composable
private fun MoreMenu(
    bar: MockBar,
    enabled: Boolean,
    copied: Boolean,
    actions: MockRoomActions,
    still: Boolean,
) {
    val c = CommishTheme.colors
    var open by remember { mutableStateOf(false) }
    Box {
        Text(
            if (copied) Words.Mock.copied else Words.Mock.more,
            style = Faces.body.copy(fontWeight = FontWeight.SemiBold),
            color = c.ink,
            modifier =
                Modifier
                    .border(1.dp, c.lineStrong, RoundedCornerShape(Tokens.Radius.pill.dp))
                    .clickable(enabled = !still, role = Role.Button) { open = true }
                    .heightIn(min = MORE_HEIGHT)
                    .padding(horizontal = Tokens.Space.s3.dp, vertical = MORE_PAD),
        )
        if (!still) {
            DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
                val item = { words: String, on: Boolean, act: () -> Unit ->
                    @Composable {
                        DropdownMenuItem(
                            text = { Text(words, style = Faces.body) },
                            enabled = on,
                            onClick = {
                                open = false
                                act()
                            },
                        )
                    }
                }
                item(bar.autopick, enabled, actions.autopick)()
                item(Words.Mock.finish, enabled, actions.finish)()
                item(if (copied) Words.Mock.copied else Words.Mock.share, true, actions.share)()
            }
        }
    }
}

private val MORE_HEIGHT = 44.dp
private val MORE_PAD = 11.dp

/** The room's top bar full screen: the close that asks first, and the page's name. */
@Composable
internal fun RoomTop(close: () -> Unit) {
    val c = CommishTheme.colors
    Row(
        Modifier
            .fillMaxWidth()
            .drawBehind { drawRect(c.line, Offset(0f, size.height - 1.dp.toPx()), Size(size.width, 1.dp.toPx())) }
            .padding(horizontal = Tokens.Space.s2.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            painterResource(R.drawable.icon_close),
            contentDescription = AppWords.mockClose,
            tint = c.ink,
            modifier = Modifier.clickable(role = Role.Button, onClick = close).padding(Tokens.Space.s3.dp).size(CLOSE_SIDE),
        )
        Text(AppWords.mock, style = Faces.body.copy(fontWeight = FontWeight.SemiBold), color = c.ink)
    }
}

private val CLOSE_SIDE = 20.dp
