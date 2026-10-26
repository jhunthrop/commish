package app.trycommish.core.companion

import app.trycommish.core.Cache
import app.trycommish.core.Clock
import app.trycommish.core.Format
import app.trycommish.core.MemoryCache
import app.trycommish.core.SessionEnd
import app.trycommish.core.companion.CompanionFixtures.Moment
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertInstanceOf
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import java.time.Instant

/**
 * The companion's view model through the engine over the recorded replay, as the iOS CompanionViewModelTests
 * hold theirs: each read asks since the pick count held and the picks merge; the turn draws our call and the
 * verb that opens the platform; the poll keeps the web's three seconds and stops with the report; hidden
 * stops it; a lost connection keeps the last picks with their stamp; a saved draft opens with no signal,
 * dated; a refused token signs out; a finish the engine lost stops with no report; a report read that fails
 * is not tried again; a draft not on the account says so and stops; a pull never reads faster than the poll;
 * a finished draft shown again reads nothing; the chip filters with no read.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class CompanionViewModelTest {
    private val main = StandardTestDispatcher()

    @BeforeEach
    fun setUp() = Dispatchers.setMain(main)

    @AfterEach
    fun tearDown() = Dispatchers.resetMain()

    private class MovingClock(
        var now: Instant,
    ) : Clock {
        override fun now(): Instant = now
    }

    private class Ends : SessionEnd {
        var count = 0

        override fun signedOut() {
            count++
        }
    }

    private fun viewModel(
        stub: StubCompanion,
        clock: Clock = MovingClock(CompanionFixtures.readAt),
        cache: Cache = MemoryCache(),
        ends: SessionEnd = Ends(),
    ) = CompanionViewModel(CompanionFixtures.ID, stub, cache, clock, CompanionFixtures.zone, ends)

    private fun room(vm: CompanionViewModel): CompanionState.Room = assertInstanceOf(CompanionState.Room::class.java, vm.state.value)

    private fun TestScope.seconds(count: Int) {
        advanceTimeBy(count * CompanionViewModel.POLL_MS / POLL_SECONDS)
        runCurrent()
    }

    @Test
    fun `the poll keeps the web's cadence, every three seconds`() {
        assertEquals(3_000L, CompanionViewModel.POLL_MS)
    }

    @Test
    fun `each read asks since the pick count held and the picks merge`() =
        runTest(main) {
            val stub = StubCompanion(CompanionFixtures.through(Moment.Taken))
            val vm = viewModel(stub)
            repeat(4) { vm.load() }
            assertEquals(listOf(0, 2, 11, 19), stub.reads)
            val (model, stale) = room(vm)
            assertFalse(stale)
            assertEquals("22 of 240", model.bar.figure)
            assertEquals("2 of 20", model.team.count)
            assertEquals(
                listOf("2.10", "GMenJay"),
                model.strip
                    ?.picks
                    ?.first()
                    ?.lines,
            )
        }

    @Test
    fun `the turn draws our call and the verb that opens the platform`() =
        runTest(main) {
            val vm = viewModel(StubCompanion(CompanionFixtures.through(Moment.Turn)))
            repeat(3) { vm.load() }
            val model = room(vm).model
            val call = requireNotNull(model.call)
            assertEquals("Make the pick on Sleeper", call.verb)
            assertFalse(call.waiting)
            assertEquals("https://sleeper.com/draft/nfl/1382163311050645504", model.bar.openUrl)
            assertNull(model.strip)
            assertEquals("14", model.since?.lead)
        }

    @Test
    fun `visible reads at once, then every three seconds, and stops with the report`() =
        runTest(main) {
            val stub = StubCompanion()
            val vm = viewModel(stub)
            vm.setVisible(true)
            runCurrent()
            assertEquals(1, stub.reads.size)
            advanceTimeBy(CompanionViewModel.POLL_MS - 1)
            runCurrent()
            assertEquals(1, stub.reads.size)
            seconds(POLL_SECONDS)
            assertEquals(2, stub.reads.size)
            advanceUntilIdle()
            assertEquals(5, stub.reads.size)
            assertEquals(1, stub.reportReads)
            assertInstanceOf(CompanionState.Report::class.java, vm.state.value)
            assertTrue(vm.done)
            assertFalse(vm.polling)
        }

    @Test
    fun `shown again within the interval waits out what is left of it before reading`() =
        runTest(main) {
            val clock = MovingClock(CompanionFixtures.readAt)
            val stub = StubCompanion()
            val vm = viewModel(stub, clock)
            vm.setVisible(true)
            runCurrent()
            assertEquals(1, stub.reads.size)
            // A rotation or a trip to another tab one second after the read.
            vm.setVisible(false)
            clock.now = clock.now.plusSeconds(1)
            vm.setVisible(true)
            runCurrent()
            assertEquals(1, stub.reads.size)
            advanceTimeBy(LEFT_MS - 1)
            runCurrent()
            assertEquals(1, stub.reads.size)
            advanceTimeBy(1)
            runCurrent()
            assertEquals(2, stub.reads.size)
            vm.setVisible(false)
        }

    @Test
    fun `shown again after the interval reads at once`() =
        runTest(main) {
            val clock = MovingClock(CompanionFixtures.readAt)
            val stub = StubCompanion()
            val vm = viewModel(stub, clock)
            vm.setVisible(true)
            runCurrent()
            vm.setVisible(false)
            clock.now = clock.now.plusSeconds(POLL_SECONDS.toLong())
            vm.setVisible(true)
            runCurrent()
            assertEquals(2, stub.reads.size)
            vm.setVisible(false)
        }

    @Test
    fun `hidden stops the poll`() =
        runTest(main) {
            val stub = StubCompanion()
            val vm = viewModel(stub)
            vm.setVisible(true)
            runCurrent()
            vm.setVisible(false)
            seconds(POLL_SECONDS * 4)
            assertEquals(1, stub.reads.size)
            assertFalse(vm.polling)
        }

    @Test
    fun `a lost connection keeps the last picks with their stamp`() =
        runTest(main) {
            val stub = StubCompanion(CompanionFixtures.through(Moment.Between))
            val vm = viewModel(stub)
            vm.load()
            stub.mode = StubMode.Offline
            vm.load()
            val (model, stale) = room(vm)
            assertTrue(stale)
            assertEquals("2 of 240", model.bar.figure)
            assertEquals("Last read ${Format.weekdayTime(CompanionFixtures.readAt, CompanionFixtures.zone)}", vm.stampWords())
            stub.mode = StubMode.Answers
            vm.load()
            assertEquals(listOf(0, 2, 2), stub.reads)
            assertFalse(room(vm).stale)
            assertEquals("11 of 240", room(vm).model.bar.figure)
            assertNull(vm.stampWords())
        }

    @Test
    fun `a saved draft opens with no signal, dated`() =
        runTest(main) {
            val cache = MemoryCache()
            viewModel(StubCompanion(listOf(Moment.Waiting)), cache = cache).load()
            val later = viewModel(StubCompanion(mode = StubMode.Offline), MovingClock(CompanionFixtures.readAt.plusSeconds(HOUR)), cache)
            later.load()
            val (model, stale) = room(later)
            assertTrue(stale)
            assertEquals("2 of 240", model.bar.figure)
            assertEquals("Last read ${Format.weekdayTime(CompanionFixtures.readAt, CompanionFixtures.zone)}", later.stampWords())
        }

    @Test
    fun `never read and nothing saved says so`() =
        runTest(main) {
            val vm = viewModel(StubCompanion(mode = StubMode.Offline))
            vm.load()
            assertEquals(CompanionState.Failed(CompanionFailure.Unreachable), vm.state.value)
        }

    @Test
    fun `a refused token signs out`() =
        runTest(main) {
            val ends = Ends()
            val vm = viewModel(StubCompanion(mode = StubMode.SignedOut), ends = ends)
            vm.load()
            assertEquals(CompanionState.Failed(CompanionFailure.SignedOut), vm.state.value)
            assertEquals(1, ends.count)
            assertTrue(vm.done)
        }

    @Test
    fun `a finish the engine lost stops the poll with no report`() =
        runTest(main) {
            val stub = StubCompanion(listOf(Moment.Waiting, Moment.Complete)) { if (it.since > 0) it.copy(lostAt = 37) else it }
            val vm = viewModel(stub)
            vm.setVisible(true)
            advanceUntilIdle()
            assertEquals(listOf(0, 2), stub.reads)
            assertEquals(0, stub.reportReads)
            assertTrue(vm.done)
            val (model, stale) = room(vm)
            assertFalse(stale)
            assertTrue(model.isComplete)
            assertNotNull(model.lost)
            vm.setVisible(false)
            vm.setVisible(true)
            advanceUntilIdle()
            assertEquals(2, stub.reads.size)
        }

    @Test
    fun `a report read that fails is not tried again`() =
        runTest(main) {
            val stub = StubCompanion(listOf(Moment.Waiting, Moment.Complete), reportFails = true)
            val vm = viewModel(stub)
            vm.setVisible(true)
            advanceUntilIdle()
            assertEquals(listOf(0, 2), stub.reads)
            assertEquals(1, stub.reportReads)
            assertTrue(vm.done)
            assertTrue(room(vm).stale)
            assertTrue(room(vm).model.isComplete)
        }

    @Test
    fun `a draft not on the account says so and stops`() =
        runTest(main) {
            val ends = Ends()
            val stub = StubCompanion(mode = StubMode.NotFound)
            val vm = viewModel(stub, ends = ends)
            vm.setVisible(true)
            advanceUntilIdle()
            assertEquals(CompanionState.Failed(CompanionFailure.Missing), vm.state.value)
            assertTrue(vm.done)
            assertEquals(0, ends.count)
            assertEquals(1, stub.reads.size)
        }

    @Test
    fun `a pull within the interval reads nothing, and beside a read waits on it`() =
        runTest(main) {
            val stub = StubCompanion()
            val vm = viewModel(stub)
            vm.load()
            vm.refresh().join()
            assertEquals(listOf(0), stub.reads)
            val read = backgroundLoad(vm)
            vm.refresh().join()
            read.join()
            assertEquals(listOf(0, 2), stub.reads)
        }

    private fun TestScope.backgroundLoad(vm: CompanionViewModel) = launch { vm.load() }

    @Test
    fun `a pull after the interval reads once`() =
        runTest(main) {
            val clock = MovingClock(CompanionFixtures.readAt)
            val stub = StubCompanion()
            val vm = viewModel(stub, clock)
            vm.load()
            clock.now = clock.now.plusSeconds(POLL_SECONDS.toLong())
            vm.refresh().join()
            assertEquals(listOf(0, 2), stub.reads)
            assertFalse(vm.refreshing.value)
        }

    @Test
    fun `the chip filters the pool with no read`() =
        runTest(main) {
            val stub = StubCompanion()
            val vm = viewModel(stub)
            vm.load()
            vm.choose("TE")
            val pool = requireNotNull(room(vm).model.pool)
            assertEquals("TE", pool.filter)
            assertTrue(pool.rows.all { it.player.position == "TE" })
            assertEquals(1, stub.reads.size)
            vm.choose("Nobody")
            assertEquals("TE", vm.filter.value)
        }

    private companion object {
        const val POLL_SECONDS = 3
        const val HOUR = 3600L

        /** What is left of the interval one second after a read. */
        const val LEFT_MS = 2_000L
    }
}
