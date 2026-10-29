package app.trycommish.core.trades

import app.trycommish.api.ApiFailure
import app.trycommish.api.Transport
import app.trycommish.api.Unauthorized
import app.trycommish.api.models.LeagueHost
import app.trycommish.api.models.LeaguePhase
import app.trycommish.api.models.LeagueStanding
import app.trycommish.api.models.TradeAdvice
import app.trycommish.api.models.TradeCheck
import app.trycommish.api.models.TradeCheckInput
import app.trycommish.core.AppWords
import app.trycommish.core.FixedClock
import app.trycommish.core.MemoryCache
import app.trycommish.core.SessionEnd
import app.trycommish.core.leaguehome.Fixtures
import app.trycommish.core.shell.FollowedLeague
import app.trycommish.core.start.StartFixtures
import app.trycommish.design.Words
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import kotlinx.serialization.json.jsonObject
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertInstanceOf
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import java.io.IOException

/**
 * The Trades view model, builder-first (Lane 260), as the iOS one is held: the saved trades at once and the
 * API's after it; a failed read keeps them with its stamp; the builder opens on our best trade's team with
 * nothing ticked; an idea loads its ticks and posts the check; ticks and another team ask again, keeping
 * only the latest answer; the builder stands without a check on an older API (a check parsed when absent)
 * and when the check fails; the verb copies the web's offer and opens the platform's page, Share copies the
 * web's text, only while the answer is the ticks'; a refused token signs out.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class TradesViewModelTest {
    private val main = StandardTestDispatcher()
    private val saturday = StartFixtures.instant(TradeFixtures.WEEK)
    private val me = TradeMe("McConkey Kong Country", "5-1, 2nd of 12")
    private val best = TradeFixtures.BEST

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

    private fun stub(check: Boolean = true) = TradesStub(TradeFixtures.trades(), if (check) TradeFixtures.check() else null)

    private fun viewModel(
        reads: TradeReads,
        cache: MemoryCache = MemoryCache(),
        copies: MutableList<String> = mutableListOf(),
        opened: MutableList<String> = mutableListOf(),
        copyTakes: Boolean = true,
        ends: SessionEnd = Ends(),
    ) = TradesViewModel(
        reads,
        cache,
        FixedClock(saturday),
        Fixtures.zone,
        LeagueHost.ffpc,
        me,
        copy = {
            copies += it
            copyTakes
        },
        openPage = { opened += it },
        sessionEnd = ends,
    )

    private fun loaded(vm: TradesViewModel): TradesState.Loaded = assertInstanceOf(TradesState.Loaded::class.java, vm.ui.value.state)

    private suspend fun TestScope.run(job: Job?) {
        advanceUntilIdle()
        job?.join()
    }

    private suspend fun TestScope.open(vm: TradesViewModel) = run(vm.load(TradeFixtures.LEAGUE))

    private val offer = "Trade with Max_Jensen10: Aaron Rodgers (QB PIT) for Jaylen Waddle (WR DEN) and Pierre Strong (RB GB)."

    private fun builder(vm: TradesViewModel): TradeBuilderModel = requireNotNull(vm.ui.value.builder)

    /** Lane 290: a host's offer loads its team and ticks like an idea and is pressed; one the builder cannot
     * hold loads nothing and asks nothing. Nothing is ever written to the host. */
    @Test
    fun `an offer loads its ticks and one the builder cannot hold loads nothing`() =
        runTest(main) {
            val stub = TradesStub(TradeFixtures.trades(TradeFixtures.NEEDS), TradeFixtures.check())
            val vm = viewModel(stub)
            open(vm)
            run(vm.loadIdea("offer:fixture-offer-2", TradeFixtures.LEAGUE))
            assertTrue(stub.checked.isEmpty())
            run(vm.loadIdea("offer:fixture-offer-1", TradeFixtures.LEAGUE))
            assertEquals(listOf(TradeCheckInput(10, listOf("4046"), listOf("4217", "6770"))), stub.checked)
            assertEquals(10, builder(vm).team)
            assertEquals("offer:fixture-offer-1", builder(vm).pressed)
            assertEquals("offer:fixture-offer-1", builder(vm).ideas.first().key)
        }

    @Test
    fun `the screen opens on the best trade's team with nothing ticked`() =
        runTest(main) {
            val stub = stub()
            val vm = viewModel(stub)
            open(vm)
            assertFalse(loaded(vm).stale)
            assertNull(vm.stampWords())
            val builder = builder(vm)
            assertEquals(8, builder.team)
            assertEquals(Words.Builder.pickBoth, builder.sentence)
            assertTrue(builder.quiet)
            assertEquals(Words.Box.none, builder.bug.yours.figures.projBefore)
            assertEquals("Max_Jensen10", builder.theirs.team)
            assertEquals("5-1, 2nd of 12", builder.yours.aside)
            assertEquals(TradeIdeas.SHOWN, builder.ideas.size)
            assertTrue(builder.more != null)
            assertFalse(builder.verbEnabled)
            assertTrue(stub.checked.isEmpty())
        }

    @Test
    fun `a saved read shows at once dated, then a failed read keeps it`() =
        runTest(main) {
            val stub = stub()
            val cache = MemoryCache()
            open(viewModel(stub, cache))
            stub.failure = IOException("no signal")
            val second = viewModel(stub, cache)
            open(second)
            assertTrue(loaded(second).stale)
            assertEquals("Last read Sat 12:00 pm", second.stampWords())
            assertEquals(8, builder(second).team)
        }

    @Test
    fun `a first read that fails says why`() =
        runTest(main) {
            val stub = stub()
            stub.failure = IOException("no signal")
            val vm = viewModel(stub)
            open(vm)
            assertEquals(TradesState.Failed(AppWords.cannotLoad), vm.ui.value.state)
        }

    @Test
    fun `an idea loads its ticks and draws both lineups`() =
        runTest(main) {
            val stub = stub()
            val vm = viewModel(stub)
            open(vm)
            run(vm.loadIdea(best, TradeFixtures.LEAGUE))
            assertEquals(listOf(TradeCheckInput(8, listOf("96"), listOf("7526", "8116"))), stub.checked)
            val builder = builder(vm)
            assertEquals(best, builder.pressed)
            // The best trade moves Waddle, whose Thursday game is final: no change this week (heldCheck).
            assertEquals(Words.Box.none, builder.bug.yours.figures.projBefore)
            assertEquals("7.3", builder.bug.yours.figures.seasonAfter)
            assertEquals("Max_Jensen10", builder.bug.theirs.name)
            assertTrue(builder.bug.yours.bar > builder.bug.theirs.bar)
            assertEquals(
                TradesParity.file
                    .getValue("builder")
                    .jsonObject["sentence"]
                    .toString()
                    .trim('"'),
                builder.sentence,
            )
            assertTrue(builder.verbEnabled)
        }

    @Test
    fun `ticks ask for both sides, then check as they land`() =
        runTest(main) {
            val stub = stub()
            val vm = viewModel(stub)
            open(vm)
            run(vm.tap(PickSide.Give, "96", TradeFixtures.LEAGUE))
            assertEquals(Words.Builder.pickTheirs, builder(vm).sentence)
            assertEquals("You, 1", builder(vm).rosters.yours)
            assertTrue(stub.checked.isEmpty())
            run(vm.tap(PickSide.Get, "12481", TradeFixtures.LEAGUE))
            assertEquals(listOf(TradeCheckInput(8, listOf("96"), listOf("12481"))), stub.checked)
            assertTrue(builder(vm).verbEnabled)
            run(vm.tap(PickSide.Get, "12481", TradeFixtures.LEAGUE))
            assertEquals(Words.Builder.pickTheirs, builder(vm).sentence)
            assertFalse(builder(vm).verbEnabled)
        }

    @Test
    fun `another team starts their side again`() =
        runTest(main) {
            val vm = viewModel(stub())
            open(vm)
            run(vm.loadIdea(best, TradeFixtures.LEAGUE))
            run(vm.chooseTeam(3, TradeFixtures.LEAGUE))
            assertEquals(3, builder(vm).team)
            assertEquals(Words.Builder.pickTheirs, builder(vm).sentence)
            assertNull(builder(vm).pressed)
        }

    @Test
    fun `N more shows every idea and the switch shows their roster`() =
        runTest(main) {
            val vm = viewModel(stub())
            open(vm)
            vm.showAllIdeas()
            assertNull(builder(vm).more)
            assertEquals(
                loaded(vm)
                    .model.ideas.places.size,
                builder(vm).ideas.size,
            )
            assertEquals(PickSide.Give, vm.ui.value.drawn)
            vm.show(PickSide.Get)
            assertEquals(PickSide.Get, vm.ui.value.drawn)
        }

    /** Review M3 and L1: tick A, then tick B while A's check is out; B's answer lands and is live, and A's
     * read is cancelled, so it can never land over B's. */
    @Test
    fun `a newer tick cancels the older check and its answer is live`() =
        runTest(main) {
            val gated = GatedTrades(TradeFixtures.trades(), TradeFixtures.check())
            val vm = viewModel(gated)
            open(vm)
            run(vm.tap(PickSide.Give, "96", TradeFixtures.LEAGUE))
            vm.tap(PickSide.Get, "7526", TradeFixtures.LEAGUE)
            advanceUntilIdle()
            val second = vm.tap(PickSide.Get, "8116", TradeFixtures.LEAGUE)
            advanceUntilIdle()
            assertEquals(listOf(listOf("7526"), listOf("7526", "8116")), gated.asked)
            gated.release(listOf("7526", "8116"))
            run(second)
            gated.release(listOf("7526"))
            advanceUntilIdle()
            assertEquals(listOf(listOf("7526")), gated.cancelled)
            assertEquals("Max_Jensen10, 2", builder(vm).rosters.theirs)
            assertTrue(builder(vm).live)
            assertEquals(best, builder(vm).pressed)
            assertFalse(vm.ui.value.checking)
        }

    @Test
    fun `a third pick waits for one put back`() {
        val picks = TradePicks(8, listOf("a", "b"), emptyList())
        assertEquals(picks, picks.tapped(PickSide.Give, "c"))
        assertEquals(TradePicks(8, listOf("b"), emptyList()), picks.tapped(PickSide.Give, "a"))
    }

    @Test
    fun `an API older than the check leaves the builder with the web's line`() =
        runTest(main) {
            val vm = viewModel(stub(check = false))
            open(vm)
            run(vm.loadIdea(best, TradeFixtures.LEAGUE))
            assertEquals(Words.InSeason.narrowingUnread, builder(vm).sentence)
            assertFalse(builder(vm).verbEnabled)
            assertFalse(loaded(vm).stale)
        }

    @Test
    fun `a check with no signal dates the read and asks again on the next tick`() =
        runTest(main) {
            val stub = stub()
            stub.checkFailure = IOException("no signal")
            val vm = viewModel(stub)
            open(vm)
            run(vm.loadIdea(best, TradeFixtures.LEAGUE))
            assertEquals(Words.InSeason.narrowingUnread, builder(vm).sentence)
            assertTrue(loaded(vm).stale)
            stub.checkFailure = null
            run(vm.tap(PickSide.Get, "8116", TradeFixtures.LEAGUE))
            run(vm.tap(PickSide.Get, "8116", TradeFixtures.LEAGUE))
            assertTrue(builder(vm).verbEnabled)
        }

    @Test
    fun `a check the API refuses says the API's sentence and leaves the read fresh`() =
        runTest(main) {
            val stub = stub()
            stub.checkFailure = ApiFailure(422, "invalid", "Josh Allen is not on your roster.")
            val vm = viewModel(stub)
            open(vm)
            run(vm.loadIdea(best, TradeFixtures.LEAGUE))
            assertEquals("Josh Allen is not on your roster.", builder(vm).sentence)
            assertFalse(loaded(vm).stale)
            assertNull(vm.stampWords())
        }

    @Test
    fun `the verb and Share copy the web's words, say what happened and open the page`() =
        runTest(main) {
            val copies = mutableListOf<String>()
            val opened = mutableListOf<String>()
            val vm = viewModel(stub(), copies = copies, opened = opened)
            open(vm)
            vm.pressBuilder()
            assertTrue(copies.isEmpty())
            run(vm.loadIdea(best, TradeFixtures.LEAGUE))
            vm.pressBuilder()
            vm.share()
            assertEquals(offer, copies.first())
            assertTrue(copies.last().startsWith("$offer Both lineups gain: yours 5.3"))
            assertTrue(copies.last().endsWith("You drop Jaxson Dart to make room."))
            assertEquals(
                "Copied. Propose it on FFPC's trade page.",
                vm.ui.value.builderCopied
                    ?.words,
            )
            assertEquals(Words.Analyzer.shared, vm.ui.value.shared)
            assertEquals(listOf(TradeFixtures.trades().hostTradesUrl), opened)
        }

    @Test
    fun `a copy that did not take says so`() =
        runTest(main) {
            val vm = viewModel(stub(), copyTakes = false)
            open(vm)
            run(vm.loadIdea(best, TradeFixtures.LEAGUE))
            vm.pressBuilder()
            vm.share()
            assertEquals(
                TradesParity.file
                    .getValue("copied")
                    .jsonObject["failed"]
                    .toString()
                    .trim('"'),
                vm.ui.value.builderCopied
                    ?.words,
            )
            assertEquals(Words.Trades.copyFailed, vm.ui.value.shared)
        }

    @Test
    fun `a refused token signs out`() =
        runTest(main) {
            val ends = Ends()
            val stub = stub()
            stub.failure = Unauthorized()
            val vm = viewModel(stub, ends = ends)
            open(vm)
            assertEquals(1, ends.count)
            assertEquals(TradesState.SignedOut, vm.ui.value.state)
        }

    @Test
    fun `the rosters' rows open the player sheet by their ids`() =
        runTest(main) {
            val vm = viewModel(stub())
            open(vm)
            val ids = builder(vm).sheetPlayers.map { it.id }
            assertTrue("96" in ids)
            assertTrue("7526" in ids)
            // A player the site has no page for (no slug) opens no sheet, as the web's row draws no link.
            assertFalse("8116" in ids)
        }

    @Test
    fun `the member is You where the league's team is unread`() {
        val league =
            FollowedLeague("l", "L", LeagueHost.ffpc, null, null, LeaguePhase.in_season, null, waiversOpen = true)
        assertEquals(TradeMe(Words.Box.you, ""), TradeMe.of(league))
        val named = league.copy(teamName = "Dad Runners", standing = LeagueStanding(5, 1, 0, 2, 12))
        assertEquals(TradeMe("Dad Runners", "5-1, 2nd of 12"), TradeMe.of(named))
    }

    @Test
    fun `before the projection is read the basis says the day it arrives`() {
        val advice = TradeFixtures.trades().copy(projectionReadAt = null, projectionArrivesAt = "2026-10-15T17:00:00Z")
        val model = TradesModel(advice, LeagueHost.ffpc, saturday, Fixtures.zone)
        assertTrue(model.basis.contains("Week 6 projections expected Thursday."))
        assertFalse(model.basis.contains("published projection"))
    }

    @Test
    fun `the check through the generated client is null on an API older than the route`() =
        runTest(main) {
            val older =
                Transport(
                    "http://api.test",
                    MockEngine {
                        respond(
                            """{"ok":false,"data":null,"error":{"code":"not_found","message":"Not found."}}""",
                            HttpStatusCode.NotFound,
                            headersOf(HttpHeaders.ContentType, "application/json"),
                        )
                    },
                    token = { "t" },
                )
            assertNull(ApiTradeReads(older).checkTrade(TradeFixtures.LEAGUE, TradeCheckInput(8, listOf("96"), listOf("12481"))))
        }

    @Test
    fun `the check through the generated client throws any other not found`() =
        runTest(main) {
            val unread =
                Transport(
                    "http://api.test",
                    MockEngine {
                        respond(
                            """{"ok":false,"data":null,"error":{"code":"team_not_read","message":"Your team is not in the last read."}}""",
                            HttpStatusCode.NotFound,
                            headersOf(HttpHeaders.ContentType, "application/json"),
                        )
                    },
                    token = { "t" },
                )
            val failure =
                runCatching { ApiTradeReads(unread).checkTrade(TradeFixtures.LEAGUE, TradeCheckInput(8, listOf("96"), listOf("12481"))) }
                    .exceptionOrNull()
            assertEquals("Your team is not in the last read.", (failure as? ApiFailure)?.message)
        }
}

/** The fixture's trades and the check, counted; or failing as told. */
internal class TradesStub(
    private val advice: TradeAdvice,
    private val check: TradeCheck?,
) : TradeReads {
    var failure: Exception? = null
    var checkFailure: Exception? = null
    val checked = mutableListOf<TradeCheckInput>()

    override suspend fun trades(
        leagueId: String,
        player: String?,
    ): String {
        failure?.let { throw it }
        return envelopeOf(advice)
    }

    override suspend fun checkTrade(
        leagueId: String,
        trade: TradeCheckInput,
    ): TradeCheck? {
        checked += trade
        checkFailure?.let { throw it }
        return check
    }
}

/** The fixture's check held at a gate per trade until the test lets it through, so two checks can land out
 * of order; a check whose coroutine is cancelled while it waits is counted as cancelled. */
internal class GatedTrades(
    private val advice: TradeAdvice,
    private val check: TradeCheck,
) : TradeReads {
    private val gates = mutableMapOf<List<String>, CompletableDeferred<Unit>>()
    val asked = mutableListOf<List<String>>()
    val cancelled = mutableListOf<List<String>>()

    private fun gate(get: List<String>): CompletableDeferred<Unit> = gates.getOrPut(get) { CompletableDeferred() }

    fun release(get: List<String>) {
        gate(get).complete(Unit)
    }

    override suspend fun trades(
        leagueId: String,
        player: String?,
    ): String = envelopeOf(advice)

    override suspend fun checkTrade(
        leagueId: String,
        trade: TradeCheckInput,
    ): TradeCheck {
        asked += trade.get
        try {
            gate(trade.get).await()
        } catch (e: CancellationException) {
            cancelled += trade.get
            throw e
        }
        return check
    }
}
