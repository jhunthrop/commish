package app.trycommish.core.leaguehome

import app.trycommish.api.Unauthorized
import app.trycommish.api.models.LeaguePhase
import app.trycommish.core.Cached
import app.trycommish.core.FixedClock
import app.trycommish.core.MemoryCache
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test
import java.io.IOException

/** The League tab opens the member's first league in its season: from the kept list at once, then
 * from the API; with neither it says why; a 401 is a sign-out. */
class LeagueChooserTest {
    private class Reads(
        private val body: String? = Fixtures.attachedBody(),
        private val unauthorized: Boolean = false,
    ) : LeagueReads {
        override suspend fun attached(): String {
            if (unauthorized) throw Unauthorized()
            return body ?: throw IOException("offline")
        }

        override suspend fun sync(leagueId: String): String = error("not read")

        override suspend fun scoreboard(leagueId: String): String = error("not read")
    }

    private val clock = FixedClock(Fixtures.sunday)
    private val chosen = LeagueChoice.Chosen(Fixtures.LEAGUE_ID, LeaguePhase.in_season, waiversOpen = true)

    @Test
    fun `the first league in its season opens, with its phase, and the list is kept`() =
        runTest {
            val cache = MemoryCache()
            assertEquals(chosen, LeagueChooser(Reads(), cache, clock).choose())
            assertEquals(Fixtures.sunday, cache.read(LeagueHomeKeys.ATTACHED)?.stamp)
        }

    @Test
    fun `the kept list chooses with no network call`() {
        val cache = MemoryCache().apply { write(LeagueHomeKeys.ATTACHED, Cached(Fixtures.attachedBody(), Fixtures.week)) }
        assertEquals(chosen, LeagueChooser(Reads(body = null), cache, clock).kept())
        assertNull(LeagueChooser(Reads(), MemoryCache(), clock).kept())
    }

    @Test
    fun `with no connection the kept list chooses`() =
        runTest {
            val cache = MemoryCache().apply { write(LeagueHomeKeys.ATTACHED, Cached(Fixtures.attachedBody(), Fixtures.week)) }
            assertEquals(chosen, LeagueChooser(Reads(body = null), cache, clock).choose())
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

    @Test
    fun `a 401 is a sign-out, never the kept list`() =
        runTest {
            val cache = MemoryCache().apply { write(LeagueHomeKeys.ATTACHED, Cached(Fixtures.attachedBody(), Fixtures.week)) }
            val choice = LeagueChooser(Reads(unauthorized = true), cache, clock).choose()
            assertEquals(LeagueChoice.SignedOut, choice)
            assertEquals(LeagueHomeWords.signedOut, choice.message())
        }
}
