package app.trycommish.core.mock

import app.trycommish.core.AppWords
import app.trycommish.core.Cache
import app.trycommish.core.FixedClock
import app.trycommish.core.MemoryCache
import app.trycommish.core.SessionEnd
import app.trycommish.design.Words
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertInstanceOf
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test

/**
 * The mock room's view model over the recorded draft, as the iOS MockRoomViewModelTests and
 * MockRoomWriteOrderTests hold theirs: a pick names the pick on the clock and lands as the API answers it; a
 * marked row is the one drafted; a room read offline shows the saved one, stale, and drafts nothing; a refused
 * write keeps the room and says the API's sentence; a refused token signs out; a turn whose call cannot be
 * read drafts from the pool; the queue is sent whole; undo, Pick for me and Finish send what they say; the
 * report's verbs run the draft again; the writes run one after another, a read never repaints over a write,
 * and the room stays busy until the next call is read.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class MockRoomViewModelTest {
    private val main = StandardTestDispatcher()

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

    private fun idle() = main.scheduler.advanceUntilIdle()

    private fun viewModel(
        stub: StubMock,
        cache: Cache = MemoryCache(),
        ends: SessionEnd = Ends(),
    ) = MockRoomViewModel(MockFixtures.ID, stub, cache, FixedClock(MockFixtures.readAt), MockFixtures.zone, ends).also {
        it.load()
        idle()
    }

    private fun room(vm: MockRoomViewModel): MockRoomState.Room = assertInstanceOf(MockRoomState.Room::class.java, vm.state.value)

    @Test
    fun `a pick round trip names the pick on the clock and shows the answer`() {
        val stub = StubMock()
        val vm = viewModel(stub)
        val call = MockFixtures.card().call
        vm.draft()
        idle()
        assertEquals(listOf(call to MockFixtures.room(MockFixtures.Answer.Create).pickNumber), stub.picks)
        val shown = room(vm)
        assertFalse(shown.stale)
        assertEquals(MockFixtures.room(MockFixtures.Answer.Pick1).pickNumber, shown.model.room.pickNumber)
        assertTrue(
            shown.model.team.slots
                .any { it.player?.id == call },
        )
    }

    @Test
    fun `a marked row is the one drafted`() {
        val stub = StubMock()
        val vm = viewModel(stub)
        val row =
            requireNotNull(
                room(vm)
                    .model.pool
                    ?.rows
                    ?.get(3),
            )
        vm.mark(row.id)
        assertEquals(
            row.id,
            room(vm)
                .model.pool
                ?.rows
                ?.first { it.marked }
                ?.id,
        )
        vm.draft()
        idle()
        assertEquals(listOf(row.id), stub.picks.map { it.first })
    }

    @Test
    fun `offline the saved room shows stale and drafts nothing`() {
        val cache = MemoryCache()
        val stub = StubMock()
        viewModel(stub, cache)
        stub.offline = true
        val vm = viewModel(stub, cache)
        val shown = room(vm)
        assertTrue(shown.stale)
        assertFalse(shown.canWrite)
        assertEquals("${Words.Mock.unreachablePhone} Last read Sun 4:00 pm", vm.staleWords())
        assertNull(vm.draft())
        assertNull(vm.finish())
        assertTrue(stub.picks.isEmpty())
    }

    @Test
    fun `offline with nothing saved says the room cannot be reached`() {
        val stub = StubMock().apply { offline = true }
        assertEquals(MockRoomState.Failed(Words.Mock.unreachablePhone), viewModel(stub).state.value)
    }

    @Test
    fun `a refused pick keeps the room and says the API's sentence`() {
        val stub = StubMock()
        val vm = viewModel(stub)
        stub.refusal = "You are not on the clock."
        vm.draft()
        idle()
        assertEquals("You are not on the clock.", vm.refusal.value)
        assertEquals(MockFixtures.room(MockFixtures.Answer.Create).pickNumber, room(vm).model.room.pickNumber)
        assertTrue(room(vm).canWrite)
    }

    @Test
    fun `a refused token signs out`() {
        val ends = Ends()
        val vm = viewModel(StubMock(signedOut = true), ends = ends)
        assertEquals(1, ends.count)
        assertEquals(MockRoomState.Failed(AppWords.signedOut), vm.state.value)
    }

    @Test
    fun `a turn whose call cannot be read drafts from the pool`() {
        val stub = StubMock().apply { cardMissing = true }
        val vm = viewModel(stub)
        val model = room(vm).model
        val noCall = assertInstanceOf(MockCallState.NoCall::class.java, model.call)
        assertEquals(
            model.pool
                ?.rows
                ?.first()
                ?.id,
            noCall.playerId,
        )
        assertTrue(noCall.verb?.startsWith(Words.Mock.draft) == true)
        vm.draft()
        idle()
        assertEquals(listOfNotNull(noCall.playerId), stub.picks.map { it.first })
    }

    @Test
    fun `the queue is sent whole and shows at once`() {
        val stub = StubMock(MockFixtures.Answer.Round5)
        val vm = viewModel(stub)
        val player = MockFixtures.room(MockFixtures.Answer.Queue).queue.first()
        vm.toggleQueue(player)
        vm.choose(Words.Mock.queue)
        assertEquals(
            listOf(player),
            room(vm)
                .model.pool
                ?.rows
                ?.map { it.id },
        )
        idle()
        assertEquals(listOf(listOf(player)), stub.queues)
        assertEquals(MockFixtures.room(MockFixtures.Answer.Queue).queue, room(vm).model.room.queue)
    }

    @Test
    fun `undo takes back your latest pick`() {
        val stub = StubMock(MockFixtures.Answer.Round5)
        val vm = viewModel(stub)
        vm.undo()
        idle()
        val round5 = MockFixtures.room(MockFixtures.Answer.Round5)
        assertEquals(listOfNotNull(round5.picks.lastOrNull { it.seat == round5.slot }?.pick), stub.undone)
    }

    @Test
    fun `pick for me drafts through three rounds past the one on the clock`() {
        val stub = StubMock(MockFixtures.Answer.Round5)
        viewModel(stub).autopick()
        idle()
        assertEquals(listOf(8), stub.autopicks)
    }

    @Test
    fun `finish reads the report and its verbs run the draft again`() {
        val stub = StubMock(MockFixtures.Answer.Round5)
        val vm = viewModel(stub)
        vm.finish()
        idle()
        val report = assertInstanceOf(MockRoomState.Report::class.java, vm.state.value)
        assertEquals(report.shareCode?.let(MockRoomViewModel::shareLink), vm.shareUrl)
        assertTrue(vm.shareUrl?.startsWith("https://trycommish.app/mock/share/") == true)
        var again: String? = null
        vm.runAgain { again = it }
        idle()
        assertEquals(MockFixtures.room(MockFixtures.Answer.Create).id.toString(), again)
        assertEquals(
            report.slot,
            stub.created
                .first()
                .settings
                ?.slot,
        )
    }

    @Test
    fun `a refused run again keeps the report and says why, and a second tap starts nothing`() {
        val stub = StubMock(MockFixtures.Answer.Round5)
        val vm = viewModel(stub)
        vm.finish()
        idle()
        assertInstanceOf(MockRoomState.Report::class.java, vm.state.value)
        stub.offline = true
        vm.runAgain {}
        idle()
        assertInstanceOf(MockRoomState.Report::class.java, vm.state.value)
        assertEquals(Words.Mock.unreachablePhone, vm.refusal.value)
        stub.offline = false
        stub.hold("create")
        var opened = 0
        vm.runAgain { opened++ }
        main.scheduler.runCurrent()
        assertNull(vm.runAgain { opened++ })
        stub.release("create")
        idle()
        assertEquals(1, stub.created.size)
        assertEquals(1, opened)
    }

    @Test
    fun `a report that cannot be read after finish says so, and try again reads it`() {
        val stub = StubMock(MockFixtures.Answer.Round5).apply { reportFails = true }
        val vm = viewModel(stub)
        vm.finish()
        idle()
        assertEquals(MockRoomState.Failed(Words.Mock.unreachablePhone), vm.state.value)
        stub.reportFails = false
        stub.opened = MockFixtures.Answer.Finish
        vm.load()
        idle()
        assertInstanceOf(MockRoomState.Report::class.java, vm.state.value)
    }

    @Test
    fun `a saved room the API refuses is final, not a lost connection`() {
        val cache = MemoryCache()
        val stub = StubMock()
        viewModel(stub, cache)
        stub.readRefused = 404
        assertEquals(MockRoomState.Failed("No mock with that id."), viewModel(stub, cache).state.value)
    }

    @Test
    fun `the link copied line shows for its moment then goes`() {
        val vm = viewModel(StubMock())
        vm.linkCopied()
        main.scheduler.runCurrent()
        assertTrue(vm.copied.value)
        main.scheduler.advanceTimeBy(MockRoomViewModel.COPIED_MS - 1)
        assertTrue(vm.copied.value)
        idle()
        assertFalse(vm.copied.value)
    }

    @Test
    fun `a pick waits for the queue's write and its answer is the last painted`() {
        val stub = StubMock()
        val vm = viewModel(stub)
        stub.hold("queue")
        vm.toggleQueue(MockFixtures.room(MockFixtures.Answer.Queue).queue.first())
        main.scheduler.runCurrent()
        vm.draft()
        main.scheduler.runCurrent()
        assertEquals(listOf("queue"), stub.writes)
        stub.release("queue")
        idle()
        assertEquals(listOf("queue", "pick"), stub.writes)
        assertEquals(MockFixtures.room(MockFixtures.Answer.Pick1).pickNumber, room(vm).model.room.pickNumber)
    }

    @Test
    fun `a read begun before a write never repaints over its answer`() {
        val stub = StubMock()
        val vm = viewModel(stub)
        stub.hold("mock")
        vm.refresh()
        main.scheduler.runCurrent()
        vm.draft()
        main.scheduler.runCurrent()
        stub.release("mock")
        idle()
        assertEquals(MockFixtures.room(MockFixtures.Answer.Pick1).pickNumber, room(vm).model.room.pickNumber)
    }

    @Test
    fun `a second draft while the next call is read sends nothing`() {
        val stub = StubMock().apply { pickWithoutCard = true }
        val vm = viewModel(stub)
        stub.hold("card")
        vm.draft()
        main.scheduler.runCurrent()
        assertFalse(room(vm).canWrite)
        assertNull(vm.draft())
        stub.release("card")
        idle()
        assertEquals(1, stub.calls.count { it == "pick" })
        assertTrue(room(vm).canWrite)
    }

    @Test
    fun `a pull's spinner shows while its read is on its way and comes down when it lands`() {
        val stub = StubMock()
        val vm = viewModel(stub)
        stub.hold("mock")
        vm.refresh()
        main.scheduler.runCurrent()
        assertTrue(vm.refreshing.value)
        stub.release("mock")
        idle()
        assertFalse(vm.refreshing.value)
    }

    @Test
    fun `a pull while a write is on its way reads nothing`() {
        val stub = StubMock()
        val vm = viewModel(stub)
        stub.hold("pick")
        vm.draft()
        main.scheduler.runCurrent()
        assertNull(vm.refresh())
        stub.release("pick")
        idle()
        assertEquals(1, stub.calls.count { it == "mock" })
    }
}
