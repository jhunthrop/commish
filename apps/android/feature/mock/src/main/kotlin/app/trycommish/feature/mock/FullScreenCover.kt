package app.trycommish.feature.mock

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.pointerInput

/** A surface over the shell is the hit target for every touch on it, so none reaches the shell's bars or the
 * page under it (Lane 214's rehearsal: a tap on the room's top bar opened the Account beneath; Lane 230's
 * review H1: the lobby's title, spinner and report fell through to the setup). It reads the touches and consumes
 * none, so the surface's own scroll, pull and taps keep them (Lane 214 review H1: consuming them in the Main
 * pass cancelled every drag and every tap that moved). */
internal fun Modifier.swallowTouches(): Modifier =
    pointerInput(Unit) {
        awaitPointerEventScope {
            while (true) awaitPointerEvent()
        }
    }

/** A full-screen surface drawn over the shell: the whole screen its hit target, whatever it draws (the lobby's
 * room and report). The one way a cover is drawn, so the next one cannot leave the hit target out. */
@Composable
fun FullScreenCover(content: @Composable () -> Unit) {
    Box(Modifier.fillMaxSize().swallowTouches()) { content() }
}
