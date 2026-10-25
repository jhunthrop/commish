package app.trycommish.core.matchup

import app.trycommish.api.Unauthorized
import app.trycommish.core.AppWords
import app.trycommish.core.Clock
import app.trycommish.core.MemoryCache
import app.trycommish.core.SessionEnd
import app.trycommish.core.leaguehome.Fixtures
import app.trycommish.core.start.StartFixtures
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertInstanceOf
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import java.io.IOException

/**
 * Another team's game on the Matchup (Lane 207, as iOS Lane 206): asked by its first side's roster, scored
 * from the scoreboard, which failing never fails the box that arrived; the member's game asks no roster
 * and no scoreboard; each game saved under its own key, so going back and forth never shows another
 * game's box.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class OtherGameViewModelTest {
    private val main = StandardTestDispatcher()
    private val league = Fixtures.LEAGUE_ID
    private val clock = MatchupFixtures.SUNDAY

    @BeforeEach
    fun setUp() = Dispatchers.setMain(main)

    @AfterEach
    fun tearDown() = Dispatchers.resetMain()

    /** The API at the Sunday clock: the member's game, or another team's with the Sleeper league's reads;
     * each box read's roster kept, each scoreboard read counted. */
    private class Stub(
        other: Boolean,
        sunday: String,
    ) : MatchupReads {
        private val syncBody = if (other) MatchupFixtures.otherSyncBody(sunday) else MatchupFixtures.syncBody(sunday)
        private val boxBody = if (other) MatchupFixtures.otherBoxBody(sunday) else MatchupFixtures.boxBody(sunday)
        private val boardBody = MatchupFixtures.otherBoardBody(sunday)
        val rosters = mutableListOf<Int?>()
        var boardReads = 0
        var signal = true
        var boardSignal = true
        var refused = false

        override suspend fun sync(leagueId: String): String {
            if (refused) throw Unauthorized()
            if (!signal) throw IOException("no signal")
            return syncBody
        }

        override suspend fun matchup(
            leagueId: String,
            roster: Int?,
        ): String? {
            rosters += roster
            if (!signal) throw IOException("no signal")
            return boxBody
        }

        override suspend fun scoreboard(leagueId: String): String {
            boardReads++
            if (!signal || !boardSignal) throw IOException("no signal")
            return boardBody
        }
    }

    private class Ends : SessionEnd {
        var count = 0

        override fun signedOut() {
            count++
        }
    }

    private fun viewModel(
        reads: MatchupReads,
        roster: Int? = MatchupFixtures.OTHER_ROSTER,
        cache: MemoryCache = MemoryCache(),
        ends: SessionEnd = Ends(),
    ): MatchupViewModel {
        val at = StartFixtures.instant(clock)
        return MatchupViewModel(
            reads,
            cache,
            object : Clock {
                override fun now() = at
            },
            Fixtures.zone,
            ends,
            roster,
        )
    }

    private fun loaded(vm: MatchupViewModel): MatchupState.Loaded = assertInstanceOf(MatchupState.Loaded::class.java, vm.state.value)

    private fun week(vm: MatchupViewModel): MatchupWeek = assertInstanceOf(MatchupModel.Week::class.java, loaded(vm).model).week

    @Test
    fun `the member's game asks no roster and reads no scoreboard`() =
        runTest(main) {
            val stub = Stub(other = false, clock)
            val vm = viewModel(stub, roster = null)
            vm.load(league)
            runCurrent()
            assertEquals(listOf<Int?>(null), stub.rosters)
            assertEquals(0, stub.boardReads)
            assertNull(week(vm).whose)
        }

    @Test
    fun `another team's game is asked by its roster and scored from the scoreboard`() =
        runTest(main) {
            val stub = Stub(other = true, clock)
            val vm = viewModel(stub)
            vm.load(league)
            runCurrent()
            assertEquals(listOf<Int?>(MatchupFixtures.OTHER_ROSTER), stub.rosters)
            assertEquals(1, stub.boardReads)
            val week = week(vm)
            assertEquals(GameWhose("Their game", "Your game"), week.whose)
            assertEquals("Carried by QJs", week.mine)
            assertEquals("Bower Rangers", week.opponent)
            assertEquals("26.7", week.bug.mine.big)
            assertEquals("43.6", week.bug.opponent?.big)
            assertTrue(
                week.bug.mine.label
                    .isEmpty() &&
                    week.bug.opponent
                        ?.label
                        ?.isEmpty() == true,
            )
            assertFalse(week.bug.mine.me)
            assertNull(week.bug.standing)
            assertTrue(week.notes.isEmpty())
            assertEquals(listOf(false, false), week.boxes.map { it.mine })
            assertTrue(week.sheetPlayers.isNotEmpty() && week.sheetPlayers.none(week::isMine))
        }

    @Test
    fun `a scoreboard that fails never fails the box that arrived`() =
        runTest(main) {
            val stub = Stub(other = true, clock).apply { boardSignal = false }
            val vm = viewModel(stub)
            vm.load(league)
            runCurrent()
            assertFalse(loaded(vm).stale)
            val week = week(vm)
            assertEquals(GameWhose.theirs, week.whose)
            assertEquals(listOf(10, 10), week.boxes.map { it.starters.size })
            assertEquals("Carried by QJs", week.bug.mine.name)
            assertTrue(week.notes.isEmpty())
        }

    @Test
    fun `each game is saved under its own key, so none shows another's box`() =
        runTest(main) {
            assertNotEquals(MatchupKeys.matchup(league), MatchupKeys.matchup(league, MatchupFixtures.OTHER_ROSTER))
            assertNotEquals(MatchupKeys.matchup(league, 2), MatchupKeys.matchup(league, 3))
            val cache = MemoryCache()
            viewModel(Stub(other = false, clock), roster = null, cache = cache).load(league)
            runCurrent()
            val theirs = viewModel(Stub(other = true, clock).apply { signal = false }, cache = cache)
            theirs.load(league)
            runCurrent()
            // Nothing saved for their game: the member's saved week is never drawn under it.
            assertEquals(MatchupState.Failed(AppWords.cannotLoad), theirs.state.value)
        }

    /** Back and forward the other way (review 206 M1): roster 2's saved week never shows under the member's
     * game or another team's, and going back to roster 2 brings its own save. */
    @Test
    fun `a game's save comes back only under its own roster`() =
        runTest(main) {
            val cache = MemoryCache()
            viewModel(Stub(other = true, clock), cache = cache).load(league)
            runCurrent()
            val offline = { Stub(other = true, clock).apply { signal = false } }
            val member = viewModel(offline(), roster = null, cache = cache)
            member.load(league)
            runCurrent()
            assertEquals(MatchupState.Failed(AppWords.cannotLoad), member.state.value)
            val sixth = viewModel(offline(), roster = 6, cache = cache)
            sixth.load(league)
            runCurrent()
            assertEquals(MatchupState.Failed(AppWords.cannotLoad), sixth.state.value)
            val back = viewModel(offline(), cache = cache)
            back.load(league)
            runCurrent()
            assertTrue(loaded(back).stale)
            assertEquals(GameWhose.theirs, week(back).whose)
            assertEquals("Carried by QJs", week(back).mine)
            assertEquals("Bower Rangers", week(back).opponent)
            assertEquals("43.6", week(back).bug.opponent?.big)
        }

    @Test
    fun `a refused token signs out from another team's game too`() =
        runTest(main) {
            val ends = Ends()
            val vm = viewModel(Stub(other = true, clock).apply { refused = true }, ends = ends)
            vm.load(league)
            runCurrent()
            assertEquals(MatchupState.SignedOut, vm.state.value)
            assertEquals(1, ends.count)
        }
}
