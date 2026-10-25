package app.trycommish.core.start

import app.trycommish.api.ApiFailure
import app.trycommish.api.Transport
import app.trycommish.api.Unauthorized
import app.trycommish.api.models.HostMoveInput
import app.trycommish.api.models.HostMovePlan
import app.trycommish.api.models.HostMoveResult
import app.trycommish.api.models.LeagueHost
import app.trycommish.core.Cached
import app.trycommish.core.Clock
import app.trycommish.core.FixedClock
import app.trycommish.core.MemoryCache
import app.trycommish.core.SessionEnd
import app.trycommish.core.leaguehome.Fixtures
import io.ktor.client.engine.mock.MockEngine
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertInstanceOf
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import java.io.IOException
import java.net.SocketTimeoutException
import java.time.Instant

/**
 * The Start screen's view model, as the iOS one is held: the saved lineup then the API's; a kicked-off
 * line never offers a move (plan Review Focus 1, at the Sunday 18:56Z fixture clock); the verb disabled
 * with the stamp's reason when the lineup shown is a saved read (Review Focus 2, over the generated
 * client and a transport that throws); the move's round trip with its done, refused and pending words;
 * the copy.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class StartViewModelTest {
    private val main = StandardTestDispatcher()
    private val saturday = StartFixtures.instant(StartFixtures.WEEK)
    private val sunday = StartFixtures.instant(StartFixtures.SUNDAY)
    private val league = Fixtures.LEAGUE_ID

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

    /** A clock a test moves. */
    private class MovingClock(
        var now: Instant,
    ) : Clock {
        override fun now(): Instant = now
    }

    private fun viewModel(
        reads: LineupReads,
        clock: Clock = FixedClock(saturday),
        host: LeagueHost = LeagueHost.espn,
        cache: MemoryCache = MemoryCache(),
        copy: (String) -> Boolean = { true },
        ends: SessionEnd = Ends(),
    ) = StartViewModel(reads, cache, clock, Fixtures.zone, host, copy, ends)

    private fun loaded(vm: StartViewModel): StartState.Loaded = assertInstanceOf(StartState.Loaded::class.java, vm.ui.value.state)

    private fun TestScope.open(vm: StartViewModel) {
        vm.load(league)
        advanceUntilIdle()
    }

    private fun TestScope.pressAndConfirm(vm: StartViewModel) {
        vm.press(league)
        advanceUntilIdle()
        vm.confirm(league)
        advanceUntilIdle()
    }

    private fun foot(vm: StartViewModel): List<String> = vm.pin().foot.map { line -> line.joinToString("") { it.text } }

    // Review Focus 1: a kicked-off line never offers a move.

    @Test
    fun `at Sunday afternoon no kicked-off line offers a move and the verb is gone`() =
        runTest(main) {
            val stub = LineupStub(listOf(StartFixtures.writesBody(StartFixtures.SUNDAY)))
            val vm = viewModel(stub, FixedClock(sunday))
            open(vm)
            val screen = loaded(vm).model
            (screen.starters + screen.bench).filter { it.row.read.locked }.forEach { assertNull(it.move, "${it.row.name} has kicked off") }
            assertTrue(screen.chips.none { it is StripChip.SwapChip })
            assertTrue(screen.move.changes.isEmpty())
            assertNull(screen.verb)
            assertNull(vm.pin().verb)
            vm.press(league)
            advanceUntilIdle()
            assertTrue(stub.planned.isEmpty())
        }

    @Test
    fun `at Sunday afternoon a kicked-off line shows its live figures`() =
        runTest(main) {
            val advice = StartFixtures.writes(StartFixtures.SUNDAY)
            val qb = advice.slots[0]
            val host = requireNotNull(qb.host)
            // The advice starts Mahomes over Rodgers at QB. Rodgers has kicked off, so the change is held and
            // the platform's starter keeps the spot with his points so far.
            val live =
                advice.copy(
                    playerPoints = true,
                    slots = listOf(qb.copy(host = host.copy(facts = host.facts.copy(pointsThisWeek = 12.4)))) + advice.slots.drop(1),
                )
            val vm = viewModel(AdviceStub(live), FixedClock(sunday))
            open(vm)
            val screen = loaded(vm).model
            val rodgers = screen.starters.first { it.row.name == "Aaron Rodgers" }
            assertEquals(GameRead.KickedOff, rodgers.row.read)
            assertEquals(RowGame.Game("at TB", "Kicked off"), rodgers.game)
            assertEquals("12.4", rodgers.pts)
            assertNull(rodgers.move)
            assertTrue(screen.team.live)
            assertEquals("Proj final", screen.team.caption)
        }

    @Test
    fun `a Saturday read pressed on Sunday takes its changes back and sends nothing`() =
        runTest(main) {
            val clock = MovingClock(saturday)
            val stub = LineupStub(listOf(StartFixtures.writesBody(StartFixtures.WEEK)))
            val vm = viewModel(stub, clock)
            open(vm)
            assertEquals("Make these changes", vm.pin().verb)
            clock.now = sunday
            vm.press(league)
            advanceUntilIdle()
            assertTrue(stub.planned.isEmpty())
            assertNull(loaded(vm).model.verb)
            assertEquals(MoveStep.Closed, vm.ui.value.step)
        }

    // Review Focus 2: offline never pretends to set the lineup.

    @Test
    fun `a saved lineup shown with no signal disables the verb with its stamp`() =
        runTest(main) {
            val cache =
                MemoryCache().apply {
                    write(
                        StartKeys.lineup(league),
                        Cached(StartFixtures.writesBody(StartFixtures.WEEK), saturday),
                    )
                }
            val offline = Transport("http://api.test", MockEngine { throw IOException("Unable to resolve host") }, token = { "t" })
            val vm = viewModel(ApiLineupReads(offline), FixedClock(saturday.plusSeconds(1800)), cache = cache)
            open(vm)
            assertTrue(loaded(vm).stale)
            assertEquals("Make these changes", vm.pin().verb)
            assertFalse(vm.pin().enabled)
            assertEquals(listOf("Last read Sat 12:00 pm. Pull down to read your lineup again before you set it."), foot(vm))
            vm.press(league)
            advanceUntilIdle()
            assertEquals(MoveStep.Closed, vm.ui.value.step)
        }

    @Test
    fun `a saved lineup disables the copy too`() =
        runTest(main) {
            val cache =
                MemoryCache().apply {
                    write(
                        StartKeys.lineup(league),
                        Cached(StartFixtures.lineupBody(StartFixtures.WEEK), saturday),
                    )
                }
            val copies = mutableListOf<String>()
            val vm =
                viewModel(LineupStub(emptyList()), host = LeagueHost.ffpc, cache = cache, copy = {
                    copies += it
                    true
                })
            open(vm)
            assertEquals("Copy the lineup", vm.pin().verb)
            assertFalse(vm.pin().enabled)
            vm.press(league)
            advanceUntilIdle()
            assertTrue(copies.isEmpty())
        }

    @Test
    fun `the saved lineup shows at once and the fresh read opens the verb`() =
        runTest(main) {
            val cache =
                MemoryCache().apply {
                    write(
                        StartKeys.lineup(league),
                        Cached(StartFixtures.writesBody(StartFixtures.WEEK), saturday),
                    )
                }
            val vm = viewModel(LineupStub(listOf(StartFixtures.writesBody(StartFixtures.WEEK))), cache = cache)
            open(vm)
            assertFalse(loaded(vm).stale)
            assertTrue(vm.pin().enabled)
            assertNull(vm.stampWords())
        }

    // The move's round trip.

    @Test
    fun `a swap round trip plans, confirms, makes and reads again`() =
        runTest(main) {
            val stub = LineupStub(List(2) { StartFixtures.writesBody(StartFixtures.WEEK) })
            val vm = viewModel(stub)
            open(vm)
            val screen = loaded(vm).model
            vm.press(league)
            advanceUntilIdle()
            assertEquals(MoveStep.Confirm(LineupStub.PLAN_SENTENCE, "tok-1"), vm.ui.value.step)
            assertEquals("Set it on ESPN", vm.pin().panel?.verb)
            assertEquals("Not now", vm.pin().panel?.close)
            assertNull(vm.pin().verb)
            vm.confirm(league)
            advanceUntilIdle()
            assertEquals(listOf(screen.move), stub.planned)
            assertEquals(listOf(screen.move to "tok-1"), stub.made)
            assertEquals(
                listOf("4046", "7543", "HOU"),
                stub.planned
                    .first()
                    .changes
                    .map { it.`in` },
            )
            assertEquals(2, stub.reads)
            val panel = requireNotNull(vm.pin().panel)
            assertEquals("Your lineup is set on ESPN.", panel.line)
            assertNull(panel.page)
            assertEquals("Done", panel.close)
            vm.close()
            assertEquals(MoveStep.Closed, vm.ui.value.step)
        }

    @Test
    fun `a refusal says the platform's own words`() =
        runTest(main) {
            val vm = viewModel(LineupStub(listOf(StartFixtures.writesBody(StartFixtures.WEEK)), outcome = HostMoveResult.Outcome.refused))
            open(vm)
            pressAndConfirm(vm)
            val panel = requireNotNull(vm.pin().panel)
            assertEquals("ESPN did not take the move, and nothing changed.", panel.line)
            assertEquals("ESPN said: Alexander Mattison is locked.", panel.said)
            assertEquals("Open ESPN", panel.page?.text)
        }

    @Test
    fun `a move not shown yet sends the member to check the platform and reads again`() =
        runTest(main) {
            val stub = LineupStub(List(2) { StartFixtures.writesBody(StartFixtures.WEEK) }, outcome = HostMoveResult.Outcome.pending)
            val vm = viewModel(stub)
            open(vm)
            pressAndConfirm(vm)
            val panel = requireNotNull(vm.pin().panel)
            assertEquals("We sent it, and ESPN has not shown it yet. Check your lineup on ESPN.", panel.line)
            assertNull(panel.said)
            assertEquals("Open ESPN", panel.page?.text)
            assertEquals("Done", panel.close)
            assertEquals(2, stub.reads)
        }

    @Test
    fun `a move with no answer may have left, so the member checks`() =
        runTest(main) {
            val vm =
                viewModel(LineupStub(listOf(StartFixtures.writesBody(StartFixtures.WEEK)), makeError = SocketTimeoutException("timed out")))
            open(vm)
            pressAndConfirm(vm)
            val panel = requireNotNull(vm.pin().panel)
            assertEquals(MovePanel.Tone.Problem, panel.tone)
            assertEquals(StartWords.lost("ESPN"), panel.line)
            assertEquals("https://sleeper.com/leagues/1382163311038038016/team", panel.page?.url)
        }

    @Test
    fun `a plan with no answer sent nothing`() =
        runTest(main) {
            val stub = LineupStub(listOf(StartFixtures.writesBody(StartFixtures.WEEK)), planError = IOException("no signal"))
            val vm = viewModel(stub)
            open(vm)
            vm.press(league)
            advanceUntilIdle()
            assertEquals("We could not reach Commish, and nothing was sent. Try again in a moment.", vm.pin().panel?.line)
            assertTrue(stub.made.isEmpty())
        }

    @Test
    fun `a refused plan says the API's sentence, the field's before the message`() =
        runTest(main) {
            val refused = ApiFailure(422, "invalid", "The move was refused.", mapOf("move" to "Aaron Rodgers has kicked off."))
            val vm = viewModel(LineupStub(listOf(StartFixtures.writesBody(StartFixtures.WEEK)), planError = refused))
            open(vm)
            vm.press(league)
            advanceUntilIdle()
            assertEquals("Aaron Rodgers has kicked off.", vm.pin().panel?.line)
            assertNull(vm.pin().panel?.page)
        }

    @Test
    fun `a plan the API cannot make here offers the platform's page`() =
        runTest(main) {
            val vm = viewModel(LineupStub(listOf(StartFixtures.writesBody(StartFixtures.WEEK)), planReady = false))
            open(vm)
            vm.press(league)
            advanceUntilIdle()
            val panel = requireNotNull(vm.pin().panel)
            assertTrue(panel.pageSolid)
            assertEquals("Set it on ESPN", panel.page?.text)
            assertNull(panel.verb)
        }

    @Test
    fun `a refused token signs out from the move`() =
        runTest(main) {
            val ends = Ends()
            val vm = viewModel(LineupStub(listOf(StartFixtures.writesBody(StartFixtures.WEEK)), planError = Unauthorized()), ends = ends)
            open(vm)
            vm.press(league)
            advanceUntilIdle()
            assertEquals(1, ends.count)
            assertEquals(MoveStep.Closed, vm.ui.value.step)
        }

    @Test
    fun `a refused token on the read signs out`() =
        runTest(main) {
            val ends = Ends()
            val vm = viewModel(LineupStub(emptyList(), readError = Unauthorized()), ends = ends)
            open(vm)
            assertEquals(1, ends.count)
            assertEquals(StartState.SignedOut, vm.ui.value.state)
        }

    @Test
    fun `nothing kept and no signal says so`() =
        runTest(main) {
            val vm = viewModel(LineupStub(emptyList(), readError = IOException("no signal")))
            open(vm)
            assertInstanceOf(StartState.Failed::class.java, vm.ui.value.state)
        }

    // The copy, where the platform takes no lineup from here.

    @Test
    fun `the copy puts the lineup on the clipboard and says where to set it`() =
        runTest(main) {
            val copies = mutableListOf<String>()
            val stub = LineupStub(listOf(StartFixtures.lineupBody(StartFixtures.WEEK)))
            val vm =
                viewModel(stub, host = LeagueHost.ffpc, copy = {
                    copies += it
                    true
                })
            open(vm)
            assertEquals(listOf("FFPC's lineup page", "FFPC takes no lineups from here."), foot(vm))
            vm.press(league)
            advanceUntilIdle()
            assertTrue(copies.first().startsWith("Week 6 lineup\nQB Patrick Mahomes"))
            assertEquals(listOf("Copied. Set it on FFPC's lineup page."), foot(vm))
            assertTrue(stub.planned.isEmpty())
        }

    @Test
    fun `a why line opens and closes`() {
        val vm = viewModel(LineupStub(emptyList()))
        vm.toggleWhy("4046")
        assertEquals(setOf("4046"), vm.ui.value.opened)
        vm.toggleWhy("4046")
        assertTrue(
            vm.ui.value.opened
                .isEmpty(),
        )
    }

    @Test
    fun `a row opens the player sheet by his id, with what the row drew`() {
        val model = startModel(StartFixtures.lineup(StartFixtures.WEEK), LeagueHost.ffpc, saturday, Fixtures.zone)
        val mahomes = requireNotNull(model.starters.first().sheetPlayer)
        assertEquals("4046", mahomes.id)
        assertEquals("patrick-mahomes", mahomes.slug)
        assertEquals("12", mahomes.rank)
        assertEquals("KC", mahomes.club)
        assertNull(model.starters.first { it.row.position == "D/ST" }.sheetPlayer)
        assertEquals(
            "IR",
            model.bench
                .first { it.row.name == "Jaxson Dart" }
                .sheetPlayer
                ?.rank,
        )
    }
}

/** The lineup's routes as a stub: each read answers the next body given (the last one again), the plan
 * answers ready with a token or unavailable, the make answers the outcome given; each call kept. */
private class LineupStub(
    private val bodies: List<String>,
    private val outcome: HostMoveResult.Outcome = HostMoveResult.Outcome.done,
    private val planReady: Boolean = true,
    private val readError: Exception? = null,
    private val planError: Exception? = null,
    private val makeError: Exception? = null,
) : LineupReads {
    var reads = 0
    val planned = mutableListOf<HostMoveInput>()
    val made = mutableListOf<Pair<HostMoveInput, String>>()

    override suspend fun lineup(leagueId: String): String {
        readError?.let { throw it }
        reads++
        if (bodies.isEmpty()) throw IOException("no signal")
        return bodies[minOf(reads, bodies.size) - 1]
    }

    override suspend fun planMove(
        leagueId: String,
        move: HostMoveInput,
    ): HostMovePlan {
        planned += move
        planError?.let { throw it }
        return HostMovePlan(
            status = if (planReady) HostMovePlan.Status.ready else HostMovePlan.Status.unavailable,
            sentence = if (planReady) PLAN_SENTENCE else "Connect ESPN again to agree to moves.",
            confirm = if (planReady) "tok-1" else null,
            expiresAt = null,
            hostUrl = "https://fantasy.espn.com/football/team",
            bid = null,
        )
    }

    override suspend fun makeMove(
        leagueId: String,
        move: HostMoveInput,
        confirm: String,
    ): HostMoveResult {
        made += move to confirm
        makeError?.let { throw it }
        val sentence =
            when (outcome) {
                HostMoveResult.Outcome.refused -> "ESPN did not take the move, and nothing changed."
                HostMoveResult.Outcome.pending -> "We sent it, and ESPN has not shown it yet. Check your lineup on ESPN."
                else -> "Your lineup is set on ESPN."
            }
        return HostMoveResult(
            outcome = outcome,
            sentence = sentence,
            hostWords = if (outcome == HostMoveResult.Outcome.refused) "Alexander Mattison is locked" else null,
            hostUrl = "https://fantasy.espn.com/football/team",
            moveId = null,
            processesAt = null,
        )
    }

    companion object {
        const val PLAN_SENTENCE = "Start Patrick Mahomes over Aaron Rodgers at QB, and two more, on ESPN now."
    }
}

/** One answer, given as the generated type, written as the API sends it. */
private class AdviceStub(
    private val advice: app.trycommish.api.models.LineupAdvice,
) : LineupReads {
    override suspend fun lineup(leagueId: String): String = envelopeOf(advice)

    override suspend fun planMove(
        leagueId: String,
        move: HostMoveInput,
    ): HostMovePlan = throw IOException("not planned in this test")

    override suspend fun makeMove(
        leagueId: String,
        move: HostMoveInput,
        confirm: String,
    ): HostMoveResult = throw IOException("not made in this test")
}
