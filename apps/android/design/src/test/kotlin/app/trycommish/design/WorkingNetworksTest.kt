package app.trycommish.design

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/** A face that failed waits on the device's networks only while it is on screen: one retry per network
 * that starts working, the watch registered while it waits and unregistered when it stops. */
@OptIn(ExperimentalCoroutinesApi::class)
class WorkingNetworksTest {
    /** Networks the test drives: who is watching, and a network that starts working. */
    private class FakeNetworks : WorkingNetworks {
        val watching = mutableListOf<() -> Unit>()
        var registered = 0
        var unregistered = 0

        override fun watch(onWorking: () -> Unit): () -> Unit {
            registered += 1
            watching += onWorking
            return {
                unregistered += 1
                watching -= onWorking
            }
        }

        fun working() = watching.toList().forEach { it() }
    }

    @Test
    fun `a network that starts working retries once, and leaving the screen unregisters`() =
        runTest {
            val networks = FakeNetworks()
            var retries = 0
            val face = launch { retryOnWorkingNetwork(networks) { retries += 1 } }
            runCurrent()
            assertEquals(1, networks.registered)
            assertEquals(0, retries)

            networks.working()
            runCurrent()
            assertEquals(1, retries)

            face.cancel()
            runCurrent()
            assertEquals(1, networks.unregistered)
            assertTrue(networks.watching.isEmpty())
            networks.working()
            runCurrent()
            assertEquals(1, retries)
        }

    @Test
    fun `the network already working when the watch begins is no event, a new or returning one is`() {
        val state = WorkingNetwork(current = "wifi")
        assertFalse(state.changed("wifi", validated = true))
        assertFalse(state.changed("cell", validated = false))
        assertTrue(state.changed("cell", validated = true))
        assertFalse(state.changed("cell", validated = true))
        state.lost("cell")
        assertTrue(state.changed("cell", validated = true))
    }

    @Test
    fun `with nothing working at the start, the first network that works is an event`() {
        val state = WorkingNetwork<String>(current = null)
        assertTrue(state.changed("wifi", validated = true))
    }
}
