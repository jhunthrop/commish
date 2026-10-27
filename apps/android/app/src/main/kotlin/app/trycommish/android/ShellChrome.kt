package app.trycommish.android

import androidx.compose.runtime.Composable
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.navigation.NavHostController
import app.trycommish.core.shell.LEAGUE_PAGE
import app.trycommish.core.shell.PlayerSheetHost
import app.trycommish.core.shell.ShellRoute
import app.trycommish.core.shell.ShellViewModel

/** What the shell draws over its pages for the member: the tab in view, the open switch, the search's
 * letters, the mock room full screen and the one player sheet. All of it goes at each sign-in and
 * sign-out ([follow]). */
@Stable
internal class ShellChrome(
    tab: MutableState<String>,
    switchOpen: MutableState<Boolean>,
    query: MutableState<String>,
    mockRoom: MutableState<String?>,
    lobby: MutableState<String?>,
    val sheet: PlayerSheetHost,
) {
    var tab by tab
    var switchOpen by switchOpen
    var query by query

    /** The mock room open full screen over the shell (its id), its bars hidden while drafting. */
    var mockRoom by mockRoom

    /** The lobby open full screen over the shell: its room, or its report once the member reads it
     * ([OpenLobby.key]). */
    private var lobbyKey by lobby

    var lobby: OpenLobby?
        get() = lobbyKey?.let(OpenLobby::of)
        set(value) {
            lobbyKey = value?.key
        }

    /** A room or a lobby is full screen over the shell: its bars out of reach. */
    val covered: Boolean get() = mockRoom != null || lobbyKey != null

    /** Nothing of the last member's: the League tab, the switch shut, no letters, no room or lobby, no sheet. */
    fun reset() {
        tab = LEAGUE_PAGE
        switchOpen = false
        query = ""
        mockRoom = null
        lobbyKey = null
        sheet.close()
    }
}

/** A lobby the app opens full screen, by its id; `report` once the member reads its report. Kept for a
 * rotation as its key, "id" or "id/report". */
internal data class OpenLobby(
    val id: String,
    val report: Boolean = false,
) {
    val key: String get() = if (report) "$id$REPORT" else id

    companion object {
        private const val REPORT = "/report"

        fun of(key: String): OpenLobby = OpenLobby(key.removeSuffix(REPORT), key.endsWith(REPORT))
    }
}

/** The shell's chrome, kept for a rotation (the sheet is held in memory, as it always was). */
@Composable
internal fun rememberShellChrome(): ShellChrome =
    ShellChrome(
        rememberSaveable { mutableStateOf(LEAGUE_PAGE) },
        rememberSaveable { mutableStateOf(false) },
        rememberSaveable { mutableStateOf("") },
        rememberSaveable { mutableStateOf<String?>(null) },
        rememberSaveable { mutableStateOf<String?>(null) },
        remember { PlayerSheetHost() },
    )

/**
 * One pass for the account in hand (ShellViewModel.step): when the screens were built for another account
 * (a sign-in or sign-out, found again after a rotation since the view model keeps it), the chrome goes,
 * every tab's stack and the view models on it go (startOver), and the view model hears it is done; then
 * the held link to push now, if its page may open (public signed out, any signed in). The account itself
 * was already forgotten by the sign-out hook, before the logout opened.
 */
internal fun ShellChrome.follow(
    shell: ShellViewModel,
    nav: NavHostController,
    signedIn: Boolean,
    asked: ShellRoute?,
    pages: List<String> = SHELL_PAGES,
): ShellRoute? {
    if (shell.step(signedIn, asked).rebuild) {
        reset()
        nav.startOver(pages)
        shell.rebuilt()
    }
    return shell.step(signedIn, asked).push
}
