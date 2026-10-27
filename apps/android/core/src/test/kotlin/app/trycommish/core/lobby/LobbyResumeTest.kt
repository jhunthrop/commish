package app.trycommish.core.lobby

import app.trycommish.api.ApiFailure
import app.trycommish.api.models.LobbyRoom
import app.trycommish.core.FixedClock
import app.trycommish.core.SessionEnd
import app.trycommish.core.room.RoomClosed
import app.trycommish.core.room.RoomCommand
import app.trycommish.core.room.RoomConnection
import app.trycommish.core.room.RoomConnector
import app.trycommish.core.room.Scripted
import app.trycommish.design.Words
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/**
 * A run again with the room held (Lane 230 review M1): a configuration change cancels the screen's run and the
 * view model, which survives it, runs again. No HTTP read, no reset to an empty room, a hello at the last seq
 * applied; and a read that did not go is tried again by a run again.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class LobbyResumeTest {
    /** Each socket sends its frames, then stays open until it is closed; the hellos it was sent are kept. */
    private class OpenSockets(
        private val frames: List<List<String>>,
    ) : RoomConnector {
        val hellos = mutableListOf<String>()
        var opens = 0
            private set

        override suspend fun open(
            url: String,
            token: String?,
        ): RoomConnection {
            val queue = Channel<String>(Channel.UNLIMITED)
            frames.getOrElse(opens) { emptyList() }.forEach { queue.trySend(it) }
            opens++
            val closed = CompletableDeferred<RoomClosed>()
            return object : RoomConnection {
                override suspend fun send(text: String) {
                    if (text.contains("\"hello\"")) hellos += text
                }

                override suspend fun receive(): String = queue.tryReceive().getOrNull() ?: throw closed.await()

                override suspend fun close(
                    code: Int,
                    reason: String,
                ) {
                    closed.complete(RoomClosed(code, reason))
                }
            }
        }
    }

    private fun text(step: Scripted): String = (step as Scripted.Server).text

    @Test
    fun `a run again after a configuration change reads nothing and says hello from the last seq`() =
        runTest {
            val rows = LobbySocketTest.frames()
            val first = rows.take(LobbySocketTest.CUT)
            val opening = listOf(text(LobbySocketTest.welcome(first[0]))) + first.drop(1).map { text(LobbySocketTest.update(it)) }
            val connector = OpenSockets(listOf(opening, emptyList()))
            val api = StubLobby()
            val vm = LobbyViewModel(LobbyFixtures.ID, api, connector, { "t" }, FixedClock(LobbyFixtures.phone), SessionEnd {}) { }
            val seen = mutableListOf<Long>()
            backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { vm.lobby.collect { it?.let { state -> seen += state.seq } } }

            val screen = launch { vm.run() }
            testScheduler.advanceUntilIdle()
            val held = vm.lobby.value?.seq ?: 0
            assertEquals(first.last().last().seq, held)
            // The rotation: the screen's run is cancelled, then the screen runs the room again.
            screen.cancel()
            testScheduler.advanceUntilIdle()
            val again = launch { vm.run() }
            testScheduler.advanceUntilIdle()
            again.cancel()

            assertEquals(1, api.reads)
            assertEquals(2, connector.opens)
            assertEquals(listOf(RoomCommand.hello(0), RoomCommand.hello(held)), connector.hellos)
            // The room never went back to empty once it held rows.
            assertFalse(seen.dropWhile { it == 0L }.contains(0L), "$seen")
            assertEquals(held, vm.lobby.value?.seq)
        }

    @Test
    fun `a room left, then run again, is read afresh`() =
        runTest {
            val rows = LobbySocketTest.frames()
            val opening = listOf(text(LobbySocketTest.welcome(rows[0])))
            val connector = OpenSockets(listOf(opening, emptyList()))
            val api = StubLobby()
            val vm = LobbyViewModel(LobbyFixtures.ID, api, connector, { "t" }, FixedClock(LobbyFixtures.phone), SessionEnd {}) { }
            val first = launch { vm.run() }
            testScheduler.advanceUntilIdle()
            assertTrue(vm.leave())
            testScheduler.advanceUntilIdle()
            first.cancel()
            // The member rejoins the same filling room: its read comes again, the socket from nothing.
            val again = launch { vm.run() }
            testScheduler.advanceUntilIdle()
            again.cancel()
            assertEquals(2, api.reads)
            assertEquals(listOf(RoomCommand.hello(0), RoomCommand.hello(0)), connector.hellos)
        }

    @Test
    fun `a room drafted to its end, then run again, is read afresh`() =
        runTest {
            val rows = LobbySocketTest.frames()
            val whole = listOf(text(LobbySocketTest.welcome(rows.flatten())))
            val connector = OpenSockets(listOf(whole, emptyList()))
            val api = StubLobby()
            val vm = LobbyViewModel(LobbyFixtures.ID, api, connector, { "t" }, FixedClock(LobbyFixtures.phone), SessionEnd {}) { }
            val first = launch { vm.run() }
            testScheduler.advanceUntilIdle()
            assertTrue(vm.lobby.value?.complete == true)
            first.cancel()
            testScheduler.advanceUntilIdle()
            val again = launch { vm.run() }
            testScheduler.advanceUntilIdle()
            again.cancel()
            assertEquals(2, api.reads)
            assertEquals(RoomCommand.hello(0), connector.hellos.last())
        }

    @Test
    fun `a read that did not go is tried again by a run again`() =
        runTest {
            val api = FlakyLobby()
            val connector = OpenSockets(listOf(emptyList()))
            val vm = LobbyViewModel(LobbyFixtures.ID, api, connector, { "t" }, FixedClock(LobbyFixtures.phone), SessionEnd {}) { }
            vm.run()
            assertEquals(LobbyScreenState.Failed(UNAVAILABLE, final = false), vm.state.value)
            val again = launch { vm.run() }
            testScheduler.advanceUntilIdle()
            assertEquals(LobbyScreenState.Room, vm.state.value)
            assertEquals(2, api.reads)
            again.cancel()
        }

    @Test
    fun `a room refused for good is not read again by a run again`() =
        runTest {
            val api = StubLobby().apply { refusal = 403 }
            val vm =
                LobbyViewModel(LobbyFixtures.ID, api, OpenSockets(emptyList()), { "t" }, FixedClock(LobbyFixtures.phone), SessionEnd {}) { }
            vm.run()
            vm.run()
            assertEquals(LobbyScreenState.Failed(Words.Lobby.noSeat, final = true), vm.state.value)
            assertEquals(1, api.reads)
        }

    /** The recorded lobby whose first room read fails with the API's own fault, then reads. */
    private class FlakyLobby(
        private val stub: StubLobby = StubLobby(),
    ) : LobbyReads by stub {
        var reads = 0
            private set

        override suspend fun lobby(id: String): LobbyRoom {
            reads++
            if (reads == 1) throw ApiFailure(HTTP_UNAVAILABLE, "unavailable", UNAVAILABLE)
            return stub.lobby(id)
        }
    }

    private companion object {
        const val HTTP_UNAVAILABLE = 503
        const val UNAVAILABLE = "The room could not be read."
    }
}
