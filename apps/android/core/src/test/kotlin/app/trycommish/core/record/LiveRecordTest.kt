package app.trycommish.core.record

import app.trycommish.api.Transport
import app.trycommish.core.FixedClock
import app.trycommish.core.MemoryCache
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assumptions.assumeTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import java.time.Instant
import java.time.ZoneId

/** The record read once from a running API through the app's own client (COMMISH_LIVE_API, a lane's dev
 * API against its own database, never production), then again naming both ETags: two 304s. Skipped with
 * no API named. Prints what it read for the lane's report. */
@OptIn(ExperimentalCoroutinesApi::class)
class LiveRecordTest {
    private val api: String? = System.getenv("COMMISH_LIVE_API")

    @BeforeEach
    fun setUp() = Dispatchers.setMain(UnconfinedTestDispatcher())

    @AfterEach
    fun tearDown() = Dispatchers.resetMain()

    @Test
    fun `the run's record reads through the app's client and an unchanged run costs two 304s`() {
        assumeTrue(api != null, "no live API named")
        val reads = CountingReads(ApiRecordReads(Transport(requireNotNull(api), token = { null })))
        val cache = MemoryCache()
        val zone = ZoneId.of("America/Chicago")
        val vm = RecordViewModel(reads, cache, FixedClock(Instant.now()), zone) {}
        runBlocking { vm.load().join() }
        val model = (vm.ui.value.state as RecordState.Loaded).model
        println("lead: ${model.lead}")
        println("bug: ${model.weekly.bug}")
        model.weekly.rows.forEach { println("week: ${it.lead} | ${it.text} | ${it.caption ?: it.order}") }
        println("draft: ${model.draft.span} ${model.draft.players}")
        assertFalse(model.lead.contains("model", ignoreCase = true))
        runBlocking { vm.load().join() }
        assertEquals(2, reads.unchanged)
    }

    private class CountingReads(
        private val inner: RecordReads,
    ) : RecordReads {
        var unchanged = 0

        override suspend fun record(tag: String?) = inner.record(tag).also { count(it) }

        override suspend fun schedule(tag: String?) = inner.schedule(tag).also { count(it) }

        private fun count(read: app.trycommish.core.board.RunRead) {
            if (read is app.trycommish.core.board.RunRead.Unchanged) unchanged += 1
        }
    }
}
