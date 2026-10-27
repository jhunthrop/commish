package app.trycommish.core.lobby

import app.trycommish.api.models.LobbyFormat
import app.trycommish.core.SessionEnd
import app.trycommish.design.Words
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/**
 * "Your seat" on the landing, as the iOS LobbyLandingTests (Lane 229's H1 and R1 to R3): kept for the signed-in
 * device only, forgotten once its room is drafted to its end or the API no longer seats the member (403, 404),
 * kept through a lapsed token (401), and redrawn the moment it is forgotten.
 */
class LobbyLandingTest {
    private fun landing(
        api: StubLobby,
        memory: MemoryLobbySeats,
        owner: String? = DEVICE,
        signedOut: () -> Unit = {},
    ) = LobbyLandingViewModel(api, memory, { owner }, SessionEnd(signedOut))

    @Test
    fun `a complete room's seat is forgotten and Join posts`() =
        runTest {
            val api = StubLobby().apply { complete = true }
            val memory = MemoryLobbySeats(DEVICE, mapOf(FORMAT to LobbyFixtures.ID))
            val vm = landing(api, memory)
            vm.load()
            val card = vm.cards.first()
            assertEquals(Words.Lobby.join, card.verb)
            assertNull(card.seat)
            assertTrue(memory.seats(DEVICE).isEmpty())
            assertEquals(LobbyFixtures.ID, vm.join(card.format))
            assertEquals(listOf(FORMAT), api.joins)
        }

    @Test
    fun `the seats redraw the moment a load forgets one`() =
        runTest {
            val api = StubLobby()
            val vm = landing(api, MemoryLobbySeats(DEVICE, mapOf(FORMAT to LobbyFixtures.ID)))
            vm.load()
            assertEquals(Words.Lobby.yourSeat, vm.cards.first().verb)
            api.complete = true
            vm.load()
            // The observed seats themselves change, not only the list beside them.
            assertTrue(vm.seated.value.isEmpty())
            assertEquals(Words.Lobby.join, vm.cards.first().verb)
        }

    @Test
    fun `a seat still drafting stays and opens its room`() =
        runTest {
            val api = StubLobby()
            val vm = landing(api, MemoryLobbySeats(DEVICE, mapOf(FORMAT to LobbyFixtures.ID)))
            vm.load()
            assertEquals(Words.Lobby.yourSeat, vm.cards.first().verb)
            assertEquals(LobbyFixtures.ID, vm.join(vm.cards.first().format))
            assertTrue(api.joins.isEmpty())
        }

    @Test
    fun `a lapsed token keeps the seat and signs out`() =
        runTest {
            val api = StubLobby().apply { refusal = 401 }
            var signedOut = false
            val memory = MemoryLobbySeats(DEVICE, mapOf(FORMAT to LobbyFixtures.ID))
            val vm = landing(api, memory) { signedOut = true }
            vm.load()
            assertTrue(signedOut)
            assertEquals(mapOf(FORMAT to LobbyFixtures.ID), vm.seated.value)
            assertEquals(mapOf(FORMAT to LobbyFixtures.ID), memory.seats(DEVICE))
        }

    @Test
    fun `a room with no seat or gone is forgotten`() =
        runTest {
            for (status in listOf(403, 404)) {
                val memory = MemoryLobbySeats(DEVICE, mapOf(FORMAT to LobbyFixtures.ID))
                val vm = landing(StubLobby().apply { refusal = status }, memory)
                vm.load()
                assertTrue(vm.seated.value.isEmpty(), "$status")
                assertTrue(memory.seats(DEVICE).isEmpty(), "$status")
            }
        }

    @Test
    fun `a sign-out leaves no seat for the next member`() =
        runTest {
            val memory = MemoryLobbySeats(DEVICE, mapOf(FORMAT to LobbyFixtures.ID))
            val api = StubLobby()
            // The next member signs in: a new paired device, so a new owner.
            val next = landing(api, memory, owner = "device-b")
            next.load()
            assertTrue(next.seated.value.isEmpty())
            assertEquals(Words.Lobby.join, next.cards.first().verb)
            assertEquals(LobbyFixtures.ID, next.join(LobbyFormat._12_ppr))
            assertEquals(listOf(FORMAT), api.joins)
            // Keeping the next member's seat dropped the first member's.
            assertTrue(memory.seats(DEVICE).isEmpty())
            // Signed out, nothing is read or kept.
            val out = landing(api, memory, owner = null)
            out.load()
            assertTrue(out.seated.value.isEmpty())
        }

    @Test
    fun `forgetting a room frees its card and a seat opened elsewhere is kept`() =
        runTest {
            val memory = MemoryLobbySeats(DEVICE, mapOf(FORMAT to "r"))
            val vm = landing(StubLobby(), memory)
            vm.load()
            vm.forget("r")
            assertTrue(vm.seated.value.isEmpty())
            vm.seat("s", LobbyFormat._10_ppr)
            assertEquals(mapOf("10_ppr" to "s"), vm.seated.value)
            assertEquals(mapOf("10_ppr" to "s"), memory.seats(DEVICE))
        }

    private companion object {
        const val DEVICE = "device-a"
        const val FORMAT = "12_ppr"
    }
}
