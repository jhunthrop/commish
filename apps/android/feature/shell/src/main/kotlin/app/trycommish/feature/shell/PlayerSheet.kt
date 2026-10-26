package app.trycommish.feature.shell

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.layout.findRootCoordinates
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInWindow
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.trycommish.core.shell.PlayerSheetHost
import app.trycommish.core.shell.PlayerSheetModel
import app.trycommish.core.shell.SheetPlayer
import app.trycommish.core.shell.ShellRoute
import app.trycommish.core.shell.playerSheetModel
import app.trycommish.design.CommishTheme
import app.trycommish.design.Faces
import app.trycommish.design.Headshot
import app.trycommish.design.PositionPill
import app.trycommish.design.R
import app.trycommish.design.Tokens
import kotlinx.coroutines.launch

/** His face's side in the sheet's head. */
private val FACE = 64.dp

/**
 * The player sheet over every screen, for the player the host shows: Material's modal bottom sheet,
 * partly open first and dragged up to the whole screen, his frame in it and `content` as its body for
 * him. The sheet is keyed by his id, so a refresh of the list under it that hands the host the same
 * player with fresh facts redraws them in place and never reopens or swaps the sheet (plan Review
 * Focus 3). Full page closes the sheet as it opens his page (PlayerSheetHost.followFullPage).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PlayerSheet(
    host: PlayerSheetHost,
    /** His full page pushed; null draws no Full page (the sheet over a draft in progress). */
    openPlayer: ((ShellRoute.Player) -> Unit)?,
    foot: @Composable (player: SheetPlayer, close: () -> Unit) -> Unit = { _, _ -> },
    content: @Composable (SheetPlayer) -> Unit = { SheetBasis(playerSheetModel(it).loading) },
) {
    val shown by host.shown.collectAsStateWithLifecycle()
    val player = shown ?: return
    key(player.id) {
        val state = rememberModalBottomSheetState(skipPartiallyExpanded = false)
        val scope = rememberCoroutineScope()
        val close: () -> Unit = { scope.launch { state.hide() }.invokeOnCompletion { host.close() } }
        // How much of the sheet is below the screen while it is partly open: the foot is lifted by it,
        // so the verb stays pinned at the sheet's visible foot at either height.
        var hidden by remember { mutableIntStateOf(0) }
        val navigationBar = WindowInsets.navigationBars.getBottom(LocalDensity.current)
        ModalBottomSheet(onDismissRequest = host::close, sheetState = state, containerColor = CommishTheme.colors.bg) {
            PlayerSheetFrame(
                playerSheetModel(player),
                close,
                openPlayer?.let { open -> { link -> host.followFullPage(link)?.let(open) } },
                Modifier.fillMaxHeight().onGloballyPositioned { frame ->
                    // The frame's bottom past the window's foot above the navigation bar.
                    val bottom = frame.positionInWindow().y + frame.size.height
                    val usable = frame.findRootCoordinates().size.height - navigationBar
                    hidden = (bottom - usable).toInt().coerceAtLeast(0)
                },
                footLift = hidden,
                foot = { foot(player, close) },
            ) {
                content(player)
            }
        }
    }
}

/**
 * The player sheet's frame (the web's player shelf): his full page and the close at its top, his face,
 * name, club and position pill from the row, then the body the screen's lane fills. Until it does, the
 * body says what the shelf says while his week is read.
 */
@Composable
fun PlayerSheetFrame(
    model: PlayerSheetModel,
    close: () -> Unit,
    /** His full page by its link; null draws no Full page. */
    openFullPage: ((String) -> Unit)?,
    modifier: Modifier = Modifier,
    /** How far the foot is lifted above the frame's own bottom: the part of the sheet below the screen. */
    footLift: Int = 0,
    /** The screen's verb, pinned at the sheet's foot under the scrolling body. */
    foot: @Composable () -> Unit = {},
    content: @Composable () -> Unit = { SheetBasis(model.loading) },
) {
    Column(modifier.fillMaxWidth().padding(horizontal = Tokens.Space.s4.dp)) {
        SheetTop(model, close, openFullPage)
        Column(
            Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(bottom = Tokens.Space.s5.dp),
            verticalArrangement = Arrangement.spacedBy(Tokens.Space.s3.dp),
        ) {
            SheetHead(model)
            content()
        }
        val ground = CommishTheme.colors.bg
        Box(
            Modifier
                .offset { IntOffset(0, -footLift) }
                // The sheet's ground under the lifted foot, down to the frame's bottom, so no body shows below it.
                .drawBehind { drawRect(ground, size = Size(size.width, size.height + footLift)) },
        ) { foot() }
    }
}

/** The sheet's top: his full page on the site, then the close. */
@Composable
private fun SheetTop(
    model: PlayerSheetModel,
    close: () -> Unit,
    openFullPage: ((String) -> Unit)?,
) {
    val c = CommishTheme.colors
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End, verticalAlignment = Alignment.CenterVertically) {
        if (openFullPage != null) FullPage(model, openFullPage)
        IconButton(onClick = close) {
            Icon(
                painterResource(R.drawable.icon_close),
                contentDescription = model.closeWords,
                tint = c.ink2,
                modifier = Modifier.size(20.dp),
            )
        }
    }
}

/** His full page on the site, the sheet's quiet link. */
@Composable
private fun FullPage(
    model: PlayerSheetModel,
    openFullPage: (String) -> Unit,
) {
    TextButton(onClick = { openFullPage(model.fullPage) }) {
        Text(
            model.fullPageWords,
            style = Faces.small.copy(fontWeight = FontWeight.SemiBold, textDecoration = TextDecoration.Underline),
            color = CommishTheme.colors.ink2,
        )
    }
}

/** What the body says while his week is read, flush with the head, in the interface face (the read
 * face in the shelf reads as a legal page, founder ruling 2026-10-21). */
@Composable
private fun SheetBasis(text: String) {
    Text(text, style = Faces.small, color = CommishTheme.colors.ink3)
}

/** His face, name, club and position pill, as the row drew him. */
@Composable
private fun SheetHead(model: PlayerSheetModel) {
    val c = CommishTheme.colors
    Row(horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s3.dp), verticalAlignment = Alignment.CenterVertically) {
        Headshot(model.headshot, model.initials, FACE)
        Column(verticalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp)) {
            Text(model.name.uppercase(), style = Faces.head, color = c.ink, modifier = Modifier.semantics { heading() })
            Row(horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp), verticalAlignment = Alignment.CenterVertically) {
                model.club?.let { Text(it, style = Faces.small.copy(fontWeight = FontWeight.Medium), color = c.ink2) }
                model.pill?.let { PositionPill(it) }
            }
        }
    }
}
