package app.trycommish.core.reference

import app.trycommish.api.ApiFailure
import app.trycommish.api.Unauthorized
import app.trycommish.api.models.BoardFormat
import app.trycommish.core.AppWords
import app.trycommish.core.Cache
import app.trycommish.core.FixedClock
import app.trycommish.core.MemoryCache
import app.trycommish.core.SessionEnd
import app.trycommish.core.board.RunFixture
import app.trycommish.core.board.RunRead
import app.trycommish.core.board.RunReads
import app.trycommish.core.board.StubRunReads
import app.trycommish.core.player.PlayerPageReads
import app.trycommish.core.player.SavedReason
import app.trycommish.core.player.StubPages
import app.trycommish.core.player.fixtureLeague
import app.trycommish.core.player.page
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertInstanceOf
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import java.time.Instant

/**
 * The reference screens' view model, held as the iOS one is after its fix round: a second open costs 304s
 * and keeps the screen fresh; with no signal the saved files stand with the offline lead; a refused token
 * signs out; a chip tapped while another's read is in flight wins (Lane 199 review M1); a format the run
 * lacks keeps the screen that worked with the web's absent words, and Try again rereads that screen (M2);
 * a pull that cannot be read keeps the screen with its reason (rereview L-b); Compare opens in the followed
 * league's format, says the absent words for a slug the run does not name, and a chip then a pick made
 * while the chip's read is held both land.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ReferenceViewModelTest {
    private val zone = RunFixture.zone

    @BeforeEach
    fun setUp() = Dispatchers.setMain(UnconfinedTestDispatcher())

    @AfterEach
    fun tearDown() = Dispatchers.resetMain()

    /** The run routes with the manifest and a format's board held until their gates open, a manifest that
     * fails on demand, and (switching) PPR's board served under every format the manifest lists. */
    private class GatedRun(
        val inner: StubRunReads,
        private val switching: Boolean = false,
    ) : RunReads by inner {
        val boardGates = mutableMapOf<String, CompletableDeferred<Unit>>()
        var manifestGate: CompletableDeferred<Unit>? = null
        var manifestFails: Exception? = null

        override suspend fun manifest(tag: String?): RunRead {
            manifestGate?.await()
            manifestFails?.let { throw it }
            return inner.manifest(tag)
        }

        override suspend fun board(
            format: String,
            tag: String?,
        ): RunRead {
            boardGates[format]?.await()
            return inner.board(if (switching) RunFixture.PPR else format, tag)
        }
    }

    private fun reads(
        run: RunReads,
        fixture: RunFixture = RunFixture.Contract,
        cache: Cache = MemoryCache(),
        offline: Boolean = false,
        at: Instant = RunFixture.inSeason,
    ) = ReferenceReads(run, StubPages(fixture, offline = offline), cache, FixedClock(at))

    private fun <Model> loadedModel(vm: RunScreenViewModel<Model>): Model {
        val state = vm.state.value
        check(state is RunScreenState.Loaded) { "$state" }
        return state.model
    }

    private fun adp(
        run: RunReads,
        cache: Cache = MemoryCache(),
        signedOut: () -> Unit = {},
    ) = AdpModel.viewModel(null, reads(run, cache = cache), zone, SessionEnd(signedOut))

    private fun slugs(fixture: RunFixture = RunFixture.Contract): List<String> = fixture.playerIds().map { fixture.page(it).slug }

    @Test
    fun `a second open answers 304s and keeps the screen fresh`() =
        runTest {
            val cache = MemoryCache()
            val run = StubRunReads(RunFixture.Contract)
            adp(run, cache).load().join()
            val first = run.answered.size
            val again = adp(run, cache)
            again.load().join()
            val second = run.answered.drop(first)
            assertTrue(second.isNotEmpty())
            assertTrue(second.all { it == 304 }, "$second")
            assertNull(again.stampWords())
        }

    @Test
    fun `with no signal the saved files stand with the offline lead`() =
        runTest {
            val cache = MemoryCache()
            adp(StubRunReads(RunFixture.Contract), cache).load().join()
            val offline =
                AdpModel.viewModel(
                    null,
                    reads(StubRunReads(RunFixture.Contract, offline = true), cache = cache, offline = true),
                    zone,
                    SessionEnd {},
                )
            offline.load().join()
            val state = assertInstanceOf(RunScreenState.Loaded::class.java, offline.state.value)
            assertEquals(SavedReason.Offline, state.freshness.saved)
            assertEquals("You're offline, so this is the last board this device saved, updated Oct 21.", offline.stampWords())
        }

    @Test
    fun `nothing saved and no signal says why with a way to try again`() =
        runTest {
            val vm = adp(StubRunReads(RunFixture.Contract, offline = true))
            vm.load().join()
            assertEquals(AppWords.cannotLoad, assertInstanceOf(RunScreenState.Failed::class.java, vm.state.value).words)
        }

    @Test
    fun `a refused token signs out`() =
        runTest {
            var out = false
            val run = GatedRun(StubRunReads(RunFixture.Contract)).apply { manifestFails = Unauthorized() }
            val vm = adp(run) { out = true }
            vm.load().join()
            assertTrue(out)
            assertEquals(AppWords.signedOut, assertInstanceOf(RunScreenState.Failed::class.java, vm.state.value).words)
        }

    @Test
    fun `a chip tapped while another's read is in flight wins`() =
        runTest {
            val run = GatedRun(StubRunReads(RunFixture.Contract), switching = true)
            val vm = adp(run)
            vm.load().join()
            val half = CompletableDeferred<Unit>()
            run.boardGates["half-ppr-12"] = half
            val held = vm.choose("half-ppr-12")
            assertEquals("half-ppr-12", vm.chosenFormat(), "the pressed chip follows the tap")
            vm.choose(RunFixture.PPR)?.join()
            half.complete(Unit)
            held?.join()
            assertEquals(RunFixture.PPR, loadedModel(vm).format)
            assertNull(vm.ask.value)
            assertNull(vm.notice.value)
        }

    @Test
    fun `a format that reads switches the screen and a second open of it costs 304s`() =
        runTest {
            val run = GatedRun(StubRunReads(RunFixture.Contract), switching = true)
            val vm = adp(run)
            vm.load().join()
            vm.choose("half-ppr-12")?.join()
            val model = loadedModel(vm)
            assertEquals("half-ppr-12", model.format)
            assertEquals("half-ppr-12", model.formats.single { it.pressed }.value)
            val before = run.inner.answered.size
            vm.load().join()
            val again = run.inner.answered.drop(before)
            assertTrue(again.isNotEmpty(), "the reread read something")
            assertTrue(again.all { it == 304 }, "$again")
        }

    @Test
    fun `a format the run lacks keeps the screen that worked with the web's words`() =
        runTest {
            val vm = adp(StubRunReads(RunFixture.Contract))
            vm.load().join()
            vm.choose("half-ppr-12")?.join()
            assertEquals(RunFixture.PPR, loadedModel(vm).format, "the screen that worked stands")
            assertEquals("Half PPR is not on our board yet", vm.notice.value)
            assertEquals("Half PPR is not on our board yet", vm.staleWords())
            assertEquals(RunFixture.PPR, vm.chosenFormat(), "the chip goes back")
            // Try again rereads the screen that worked, and its notice goes.
            vm.load().join()
            assertEquals(RunFixture.PPR, loadedModel(vm).format)
            assertNull(vm.notice.value)
        }

    @Test
    fun `a pull that cannot be read keeps the screen with the reason`() =
        runTest {
            val run = GatedRun(StubRunReads(RunFixture.Contract))
            val vm = adp(run)
            vm.load().join()
            run.manifestFails = ApiFailure(404, "not_found", "The run is not published.")
            vm.load().join()
            assertEquals(RunFixture.PPR, loadedModel(vm).format)
            assertEquals("The run is not published.", vm.staleWords())
        }

    @Test
    fun `Compare opens in the followed league's format where the run carries it`() =
        runTest {
            val league = fixtureLeague.copy(format = BoardFormat.standard)
            assertEquals("standard-12", CompareAsk.runFormat(league))
            val vm = CompareReader.viewModel(slugs().take(2), league, reads(StubRunReads(RunFixture.Contract)), zone, SessionEnd {})
            vm.load().join()
            assertEquals("standard-12", loadedModel(vm).format)
            val none = CompareReader.viewModel(slugs().take(2), null, reads(StubRunReads(RunFixture.Contract)), zone, SessionEnd {})
            none.load().join()
            assertEquals(RunFixture.PPR, loadedModel(none).format, "the run's default with no league")
        }

    @Test
    fun `Compare says the web's absent words for a slug the run does not name`() =
        runTest {
            val vm =
                CompareReader.viewModel(
                    listOf(slugs().first(), "nobody"),
                    null,
                    reads(StubRunReads(RunFixture.Contract)),
                    zone,
                    SessionEnd {},
                )
            vm.load().join()
            val model = loadedModel(vm)
            assertInstanceOf(CompareSlot.Picked::class.java, model.slots[0])
            assertEquals(CompareSlot.Missing, model.slots[1])
            assertEquals(CompareModel.firstStep(1), model.lead)
            assertEquals(CompareOutcome.None, model.outcome)
        }

    @Test
    fun `a Compare chip then a pick made while the chip's read is held both land`() =
        runTest {
            val slugs = slugs()
            val run = GatedRun(StubRunReads(RunFixture.Contract))
            val vm = CompareReader.viewModel(listOf(slugs[0], null), null, reads(run), zone, SessionEnd {})
            vm.load().join()
            val gate = CompletableDeferred<Unit>()
            run.manifestGate = gate
            val chip = vm.chooseFormat("half-ppr-12")
            assertEquals("half-ppr-12", vm.chosenFormat())
            val pick = vm.choose(1, slugs[1])
            gate.complete(Unit)
            chip?.join()
            pick?.join()
            val model = loadedModel(vm)
            assertEquals("half-ppr-12", model.format)
            assertEquals(listOf(slugs[0], slugs[1]), model.slugs)
            assertNull(vm.ask.value)
        }

    @Test
    fun `a pick then a Compare chip made while the pick's read is held both land`() =
        runTest {
            val slugs = slugs()
            val run = GatedRun(StubRunReads(RunFixture.Contract))
            val vm = CompareReader.viewModel(listOf(slugs[0], null), null, reads(run), zone, SessionEnd {})
            vm.load().join()
            val gate = CompletableDeferred<Unit>()
            run.manifestGate = gate
            val pick = vm.choose(1, slugs[1])
            val chip = vm.chooseFormat("standard-12")
            gate.complete(Unit)
            pick?.join()
            chip?.join()
            val model = loadedModel(vm)
            assertEquals("standard-12", model.format)
            assertEquals(listOf(slugs[0], slugs[1]), model.slugs)
        }

    /** The page routes with one player's page answering 404 and none held for him (the iOS MissingPage). */
    private class MissingPage(
        private val inner: StubPages,
        private val id: String,
    ) : PlayerPageReads by inner {
        override suspend fun page(
            id: String,
            tag: String?,
        ): RunRead {
            if (id == this.id) throw ApiFailure(NOT_FOUND, "not_found", "The run has no page for this player.")
            return inner.page(id, tag)
        }
    }

    @Test
    fun `a page the run cannot give shows the absent words too`() =
        runTest {
            // The index names him, but his page is gone and the run held none: the route answers 404.
            val pages = MissingPage(StubPages(RunFixture.Contract), "4429795")
            val reads = ReferenceReads(StubRunReads(RunFixture.Contract), pages, MemoryCache(), FixedClock(RunFixture.inSeason))
            val vm = CompareReader.viewModel(listOf("jahmyr-gibbs", "josh-allen"), null, reads, zone, SessionEnd {})
            vm.load().join()
            val model = loadedModel(vm)
            assertEquals(CompareSlot.Missing, model.slots[0])
            assertInstanceOf(CompareSlot.Picked::class.java, model.slots[1])
            assertEquals(CompareOutcome.None, model.outcome)
        }

    @Test
    fun `picking and clearing a side rebuilds the table`() =
        runTest {
            val vm = CompareReader.viewModel(listOf(null, null), null, reads(StubRunReads(RunFixture.Contract)), zone, SessionEnd {})
            vm.load().join()
            val empty = loadedModel(vm)
            assertEquals(CompareModel.firstStep(0), empty.lead)
            assertEquals(listOf("Josh Allen"), empty.search("all").map { it.name })
            assertEquals(listOf("Josh Allen", "Josh Jacobs"), empty.search("JOSH").map { it.name })
            vm.choose(0, "josh-allen")?.join()
            vm.choose(1, "josh-jacobs")?.join()
            val both = loadedModel(vm)
            assertNull(both.lead)
            val table = assertInstanceOf(CompareOutcome.Table::class.java, both.outcome).table
            assertEquals(listOf("Josh Allen", "Josh Jacobs"), table.heads.map { it.name })
            vm.choose(0, null)?.join()
            assertEquals(CompareSlot.Open, loadedModel(vm).slots[0])
            vm.choose(0, "josh-jacobs")?.join()
            assertInstanceOf(CompareOutcome.Same::class.java, loadedModel(vm).outcome)
        }

    private companion object {
        const val NOT_FOUND = 404
    }
}
