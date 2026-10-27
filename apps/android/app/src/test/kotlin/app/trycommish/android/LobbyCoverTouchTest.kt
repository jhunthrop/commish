package app.trycommish.android

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.click
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTouchInput
import app.trycommish.api.models.LobbyRoom
import app.trycommish.api.models.MockReport
import app.trycommish.core.AppWords
import app.trycommish.core.FixedClock
import app.trycommish.core.SessionEnd
import app.trycommish.core.lobby.LobbyFixtures
import app.trycommish.core.lobby.LobbyReads
import app.trycommish.core.lobby.LobbyReportViewModel
import app.trycommish.core.lobby.LobbyViewModel
import app.trycommish.core.lobby.StubLobby
import app.trycommish.core.mock.StubMock
import app.trycommish.core.room.RoomConnector
import app.trycommish.feature.mock.FullScreenCover
import app.trycommish.feature.mock.LobbyExits
import app.trycommish.feature.mock.LobbyReportView
import app.trycommish.feature.mock.LobbyRoomView
import kotlinx.coroutines.awaitCancellation
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * The lobby over the shell takes every touch on it (Lane 230 review H1): a tap on the room's title, on its
 * spinner while it loads, or on the report's top bar never reaches what is under the cover. Without the cover's
 * hit target the same taps do reach it, so the test can see the fall-through it guards against.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class LobbyCoverTouchTest {
    @get:Rule
    val compose = createComposeRule()

    /** The room and the report still loading: their reads never answer. */
    private class Loading(
        private val stub: StubLobby = StubLobby(),
    ) : LobbyReads by stub {
        override suspend fun lobby(id: String): LobbyRoom = awaitCancellation()

        override suspend fun report(id: String): MockReport = awaitCancellation()
    }

    private val never = RoomConnector { _, _ -> awaitCancellation() }

    private fun room() = LobbyViewModel(LobbyFixtures.ID, Loading(), never, { null }, FixedClock(LobbyFixtures.phone), SessionEnd {})

    private fun report() = LobbyReportViewModel(LobbyFixtures.ID, Loading(), StubMock(), SessionEnd {})

    private val exits = LobbyExits(close = {}, left = {}, report = {}, opened = {})

    /** The cover (or the bare screen) over a sibling that counts the taps reaching it. */
    private fun under(
        covered: Boolean,
        screen: @Composable () -> Unit,
    ): () -> Int {
        var reached = 0
        compose.setContent {
            Box(Modifier.fillMaxSize()) {
                Box(Modifier.fillMaxSize().clickable { reached++ })
                if (covered) FullScreenCover(screen) else screen()
            }
        }
        return { reached }
    }

    @Test
    fun `a tap on the room's title or its spinner stays on the cover`() {
        val reached = under(covered = true) { LobbyRoomView(room(), exits) }
        compose.onNodeWithText(AppWords.mock).performClick()
        compose.onRoot().performTouchInput { click(center) }
        compose.waitForIdle()
        assertEquals(0, reached())
    }

    @Test
    fun `a tap on the report's top bar or while it loads stays on the cover`() {
        val reached = under(covered = true) { LobbyReportView(report(), lobbies = {}, solo = {}) }
        compose.onNodeWithText(AppWords.mock).performClick()
        compose.onRoot().performTouchInput { click(center) }
        compose.waitForIdle()
        assertEquals(0, reached())
    }

    @Test
    fun `without the cover the same taps fall through`() {
        val reached = under(covered = false) { LobbyRoomView(room(), exits) }
        compose.onNodeWithText(AppWords.mock).performClick()
        compose.onRoot().performTouchInput { click(center) }
        compose.waitForIdle()
        assertEquals(2, reached())
    }
}
