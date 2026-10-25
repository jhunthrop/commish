package app.trycommish.core.board

import app.trycommish.api.ApiFailure
import app.trycommish.api.Unauthorized
import app.trycommish.core.Cache
import app.trycommish.core.FixedClock
import app.trycommish.core.MemoryCache
import app.trycommish.core.SessionEnd
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertInstanceOf
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import java.net.SocketTimeoutException
import java.time.Instant

/**
 * The Board's view model, held as the iOS one is: the run read through its routes with the kept ETags
 * sent as the API gave them, an unchanged run costing five 304s and refreshing only the stamp, the saved
 * board at once on the next open, offline kept and stale with its reason, a failed read kept with "Last
 * read", the chips held across reads, a format the run lacks keeping its chips up, a refused token
 * signing out, and a run that turns between the manifest and the board read again afresh.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class BoardViewModelTest {
    private val main = StandardTestDispatcher()
    private val now = RunFixture.inSeason

    @BeforeEach
    fun setUp() = Dispatchers.setMain(main)

    @AfterEach
    fun tearDown() = Dispatchers.resetMain()

    private class Ends : SessionEnd {
        var count = 0

        override fun signedOut() {
            count++
        }
    }

    private fun viewModel(
        reads: RunReads,
        cache: Cache = MemoryCache(),
        at: Instant = now,
        ends: SessionEnd = Ends(),
        inSeason: Boolean = true,
    ) = BoardViewModel(reads, cache, FixedClock(at), RunFixture.zone, inSeason, following = false, sessionEnd = ends)

    private fun TestScope.loaded(vm: BoardViewModel): BoardState.Loaded {
        vm.load()
        runCurrent()
        return assertInstanceOf(BoardState.Loaded::class.java, vm.state.value)
    }

    @Test
    fun `the run reads fresh, then an unchanged run costs five 304s with the tags sent raw and refreshes only the stamp`() =
        runTest(main) {
            val reads = StubRunReads(RunFixture.Contract)
            val cache = MemoryCache()
            val first = loaded(viewModel(reads, cache))
            assertNull(first.stale)
            assertEquals(List(5) { 200 }, reads.answered)
            assertTrue(reads.sent.all { it.second == null })

            reads.sent.clear()
            reads.answered.clear()
            val later = now.plusSeconds(600)
            val again = viewModel(reads, cache, at = later)
            val second = loaded(again)
            assertEquals(List(5) { 304 }, reads.answered)
            assertEquals(
                setOf(
                    "W/\"2026-10-21T12-ros/manifest.json\"",
                    "W/\"2026-10-21T12-ros/boards/ppr-12.json\"",
                    "W/\"2026-10-21T12-ros/adp.json\"",
                    "W/\"2026-10-21T12-ros/designations.json\"",
                    "W/\"2026-10-21T12-ros/clubs.json\"",
                ),
                reads.sent.map { it.second }.toSet(),
            )
            assertEquals(later, second.stamp)
            assertEquals(first.model, second.model)
            assertEquals(later, cache.read(BoardViewModel.route(null))?.stamp)
        }

    @Test
    fun `with no signal the saved board shows, stale with the offline words and the run's day`() =
        runTest(main) {
            val cache = MemoryCache()
            loaded(viewModel(StubRunReads(RunFixture.Contract), cache))
            val vm = viewModel(StubRunReads(RunFixture.Contract, offline = true), cache, at = now.plusSeconds(1800))
            val state = loaded(vm)
            assertEquals(BoardStale.Offline, state.stale)
            assertEquals(now, state.stamp)
            assertEquals("You're offline, so this is the last board this device saved, updated Oct 21.", vm.stampWords())
        }

    @Test
    fun `a read that fails another way keeps the board with when it was last read`() =
        runTest(main) {
            val reads = StubRunReads(RunFixture.Contract)
            val failing =
                object : RunReads by reads {
                    override suspend fun manifest(tag: String?): RunRead = throw SocketTimeoutException("slow")
                }
            val cache = MemoryCache()
            loaded(viewModel(reads, cache))
            val kept = viewModel(failing, cache)
            val state = loaded(kept)
            assertEquals(BoardStale.Failed, state.stale)
            assertEquals("Last read Thu 12:00 pm", kept.stampWords())
        }

    @Test
    fun `with nothing saved and no signal the screen says so`() =
        runTest(main) {
            val vm = viewModel(StubRunReads(RunFixture.Contract, offline = true))
            vm.load()
            runCurrent()
            assertInstanceOf(BoardState.Failed::class.java, vm.state.value)
        }

    @Test
    fun `a position chip redraws the same read with no read, and the chips stay through a pull`() =
        runTest(main) {
            val reads = StubRunReads(RunFixture.StandIn)
            val vm = viewModel(reads, at = RunFixture.preDraft, inSeason = false)
            loaded(vm)
            val count = reads.sent.size
            vm.choose(BoardPosition.Receiver)
            assertEquals(count, reads.sent.size)
            val wr = assertInstanceOf(BoardState.Loaded::class.java, vm.state.value)
            assertTrue(
                wr.model.positions
                    .single { it.pressed }
                    .value == BoardPosition.Receiver,
            )
            assertTrue(
                wr.model.sections
                    .first()
                    .band != null,
            )
            val pulled = loaded(vm)
            assertEquals(BoardFilter(null, BoardPosition.Receiver), vm.filter.value)
            assertEquals(wr.model, pulled.model)
        }

    @Test
    fun `a format the run lacks keeps its chips up and never shows another format's rows`() =
        runTest(main) {
            val vm = viewModel(StubRunReads(RunFixture.Contract))
            loaded(vm)
            vm.choose("half-ppr-12")
            runCurrent()
            val failed = assertInstanceOf(BoardState.Failed::class.java, vm.state.value)
            assertEquals("The run has no half-ppr-12 board.", failed.message)
            val chips = BoardModel.formatChips(vm.formats.value, vm.filter.value.format)
            assertEquals(listOf("half-ppr-12"), chips.filter { it.pressed }.map { it.value })
            assertEquals(3, chips.size)
            vm.choose("ppr-12")
            runCurrent()
            assertInstanceOf(BoardState.Loaded::class.java, vm.state.value)
        }

    @Test
    fun `a refused token signs the phone out`() =
        runTest(main) {
            val ends = Ends()
            val refusing =
                object : RunReads by StubRunReads(RunFixture.Contract) {
                    override suspend fun manifest(tag: String?): RunRead = throw Unauthorized()
                }
            val vm = viewModel(refusing, ends = ends)
            vm.load()
            runCurrent()
            assertEquals(BoardState.SignedOut, vm.state.value)
            assertEquals(1, ends.count)
        }

    @Test
    fun `a board of another run than the manifest is read again afresh, once`() =
        runTest(main) {
            val stub = StubRunReads(RunFixture.Contract)
            var turned = false
            val turning =
                object : RunReads by stub {
                    override suspend fun board(
                        format: String,
                        tag: String?,
                    ): RunRead =
                        if (turned) {
                            stub.board(format, tag)
                        } else {
                            turned = true
                            RunRead.Fresh(RunFixture.StandIn.boardAnswer(format), "W/\"other\"")
                        }
                }
            val read = RunBoardReader.read(turning, null, null)
            assertEquals(RunFixture.Contract.runId, read.board.runId)
            // Four files the first time (its board came from the other run), all five again.
            assertEquals(9, stub.sent.size)
        }

    @Test
    fun `a 304 for a file never kept is refused, not drawn`() {
        val failure = runCatching { RunBoardReader.resolve(RunRead.Unchanged("W/\"x\""), null) }.exceptionOrNull()
        assertInstanceOf(RunReadFailure.UnchangedWithoutCopy::class.java, failure)
    }

    @Test
    fun `only no connection reads as offline`() {
        assertTrue(BoardViewModel.offline(java.net.UnknownHostException("api")))
        assertTrue(!BoardViewModel.offline(SocketTimeoutException("slow")))
        assertTrue(!BoardViewModel.offline(ApiFailure(500, "x", "y")))
    }
}
