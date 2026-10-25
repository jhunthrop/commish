package app.trycommish.feature.shell

import androidx.compose.runtime.staticCompositionLocalOf
import app.trycommish.core.shell.PlayerSheetHost

/** The app's one player sheet host: a screen opens a row's player with
 * `LocalPlayerSheet.current.open(player)` and hands it its rows again after a refresh. */
val LocalPlayerSheet = staticCompositionLocalOf<PlayerSheetHost> { error("The shell provides the player sheet host.") }
