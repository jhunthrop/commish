package app.trycommish.core.leaguehome

import app.trycommish.core.Cached
import app.trycommish.core.FixedClock
import app.trycommish.core.MemoryCache
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import java.io.IOException

/** The League tab opens the member's first league in its season, from the API, else from the kept
 * list when there is no connection; with neither it says why. */
class LeagueChooserTest {
    private class Reads(
        private val body: String? = Fixtures.attachedBody(),
    ) : LeagueReads {
        override suspend fun attached(): String = body ?: throw IOException("offline")

        override suspend fun sync(leagueId: String): String = error("not read")

        override suspend fun scoreboard(leagueId: String): String = error("not read")
    }

    private val clock = FixedClock(Fixtures.sunday)

    @Test
    fun `the first league in its season opens and the list is kept`() =
        runTest {
            val cache = MemoryCache()
            assertEquals(LeagueChoice.Chosen(Fixtures.LEAGUE_ID), LeagueChooser(Reads(), cache, clock).choose())
            assertEquals(Fixtures.sunday, cache.read(LeagueHomeKeys.ATTACHED)?.stamp)
        }

    @Test
    fun `with no connection the kept list chooses`() =
        runTest {
            val cache = MemoryCache().apply { write(LeagueHomeKeys.ATTACHED, Cached(Fixtures.attachedBody(), Fixtures.week)) }
            assertEquals(LeagueChoice.Chosen(Fixtures.LEAGUE_ID), LeagueChooser(Reads(body = null), cache, clock).choose())
        }

    @Test
    fun `with no connection and nothing kept the tab says it cannot reach Commish`() =
        runTest {
            val choice = LeagueChooser(Reads(body = null), MemoryCache(), clock).choose()
            assertEquals(LeagueChoice.Unreachable, choice)
            assertEquals(LeagueHomeWords.cannotLoad, choice.message())
        }

    @Test
    fun `a member with no league is told where to attach one`() =
        runTest {
            val choice = LeagueChooser(Reads(body = """{"ok":true,"data":[],"error":null}"""), MemoryCache(), clock).choose()
            assertEquals(LeagueChoice.NoLeague, choice)
            assertEquals(LeagueHomeWords.noLeague, choice.message())
        }
}
