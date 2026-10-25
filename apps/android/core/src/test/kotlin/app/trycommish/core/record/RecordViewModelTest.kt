package app.trycommish.core.record

import app.trycommish.api.CommishJson
import app.trycommish.api.Unauthorized
import app.trycommish.core.FixedClock
import app.trycommish.core.MemoryCache
import app.trycommish.core.leaguehome.Fixtures
import app.trycommish.core.rankings.RankingsFixtures
import app.trycommish.core.rankings.RecordFixture
import app.trycommish.core.rankings.StubRecord
import app.trycommish.core.start.StartFixtures
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import java.time.Instant

/** Our record's view model over the record's fixtures at a fixed clock, as the iOS one's tests: the record
 * reads with its schedule and saves both with their ETags; an unchanged run costs two 304s and refreshes
 * only the stamp; with no signal the saved record shows stale; the chips hold what was chosen; a refused
 * token signs out. */
@OptIn(ExperimentalCoroutinesApi::class)
class RecordViewModelTest {
    private val main = StandardTestDispatcher()
    private val week = StartFixtures.instant(RankingsFixtures.WEEK)

    @BeforeEach
    fun setUp() = Dispatchers.setMain(main)

    @AfterEach
    fun tearDown() = Dispatchers.resetMain()

    private fun record(
        reads: RecordReads,
        cache: MemoryCache = MemoryCache(),
        now: Instant = week,
        signedOut: () -> Unit = {},
    ) = RecordViewModel(reads, cache, FixedClock(now), Fixtures.zone, signedOut)

    @Test
    fun `the record reads with its schedule and saves both with their ETags`() =
        runTest(main) {
            val cache = MemoryCache()
            val vm = record(StubRecord(RecordFixture.Graded), cache)
            vm.load()
            advanceUntilIdle()
            val loaded = vm.ui.value.state as RecordState.Loaded
            assertFalse(loaded.stale)
            assertEquals(
                "Weekly record" to "Our weekly rankings against ESPN and the week's published projection",
                loaded.model.weekly.head,
            )
            val saved = CommishJson.decodeFromString(RecordBodies.serializer(), requireNotNull(cache.read(RecordViewModel.ROUTE)).body)
            assertEquals(RecordFixture.Graded.tag, saved.record.tag)
            assertEquals(RecordFixture.SCHEDULE_TAG, saved.schedule.tag)
        }

    @Test
    fun `an unchanged record costs two 304s and refreshes only the stamp`() =
        runTest(main) {
            val cache = MemoryCache()
            record(StubRecord(RecordFixture.Own), cache).load()
            advanceUntilIdle()
            val later = week.plusSeconds(3600)
            val reads = StubRecord(RecordFixture.Own)
            val vm = record(reads, cache, later)
            vm.load()
            advanceUntilIdle()
            val loaded = vm.ui.value.state as RecordState.Loaded
            assertFalse(loaded.stale)
            assertEquals(later, loaded.stamp)
            assertEquals(2, reads.unchanged)
            assertEquals(setOf(RecordFixture.Own.tag, RecordFixture.SCHEDULE_TAG), reads.tags.toSet(), "both read together")
            assertTrue(loaded.model.lead.startsWith("How the order we set before each week's kickoff"))
        }

    @Test
    fun `with no signal the saved record shows stale`() =
        runTest(main) {
            val cache = MemoryCache()
            record(StubRecord(RecordFixture.Own), cache).load()
            advanceUntilIdle()
            val vm = record(StubRecord(RecordFixture.Own, offline = true), cache)
            vm.load()
            advanceUntilIdle()
            assertTrue((vm.ui.value.state as RecordState.Loaded).stale)
            assertEquals("Last read Sat 12:00 pm", vm.stampWords())
        }

    @Test
    fun `a refused token signs out`() =
        runTest(main) {
            var signedOut = false
            val vm = record(RefusingRecord, signedOut = { signedOut = true })
            vm.load()
            advanceUntilIdle()
            assertTrue(signedOut)
            assertEquals(RecordState.SignedOut, vm.ui.value.state)
        }

    @Test
    fun `the record's chips hold what was chosen`() {
        val vm = record(StubRecord(RecordFixture.Own))
        vm.chooseFigure(RecordFigure.PlacesOff)
        vm.choosePosition("WR")
        vm.chooseDraftFigure(RecordFigure.Starters)
        assertEquals(RecordFigure.PlacesOff, vm.ui.value.figure)
        assertEquals("WR", vm.ui.value.position)
        assertEquals(RecordFigure.Starters, vm.ui.value.draftFigure)
    }

    @Test
    fun `the scoring is the manifest's label for the run's format`() {
        assertEquals("PPR", RecordViewModel.scoring("ppr-12"))
        assertEquals("Half PPR", RecordViewModel.scoring("half-12"))
        assertEquals("Standard", RecordViewModel.scoring("standard-12"))
    }

    /** Every read refused: the device token is no longer good. */
    private object RefusingRecord : RecordReads {
        override suspend fun record(tag: String?) = throw Unauthorized()

        override suspend fun schedule(tag: String?) = throw Unauthorized()
    }
}
