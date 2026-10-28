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
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import kotlinx.serialization.json.jsonArray
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
 * The Trades view model, as the iOS one is held: the saved finder at once and the API's after it; a failed
 * read keeps the finder with its stamp; the chips and the gain heads reorder it; a trade opens into its
 * players; the picker narrows to the trades holding a player read from the API; the builder from a trade or
 * new posts the check of the trade built as picks land, stands without it on an older API (a check parsed
 * when absent), and keeps the finder when the check fails; the verbs copy the web's share text and open
 * the platform's page; a refused token signs out.
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

    private fun stub(check: Boolean = true) =
        TradesStub(TradeFixtures.trades(), TradeFixtures.holding(), if (check) TradeFixtures.check() else null)

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

    private fun webBest(sort: String): List<String?> =
        TradesParity.file
            .getValue("clocks")
            .jsonObject
            .getValue(TradeFixtures.WEEK)
            .jsonObject
            .getValue("finder")
            .jsonObject
            .let { finder ->
                listOf("best", "every").associateWith {
                    finder
                        .getValue(it)
                        .jsonObject
                        .getValue(sort)
                        .jsonArray
                }
            }.getValue("best")
            .map { it.jsonObject["key"].toString().trim('"') }

    @Test
    fun `the finder reads and is the web's`() =
        runTest(main) {
            val cache = MemoryCache()
            val vm = viewModel(stub(), cache)
            open(vm)
            assertFalse(loaded(vm).stale)
            assertNull(vm.stampWords())
            assertEquals(
                best,
                loaded(vm)
                    .model.rows
                    .first()
                    .key,
            )
            assertEquals(9, loaded(vm).model.rows.size)
            assertEquals(saturday, cache.read(TradeKeys.trades(TradeFixtures.LEAGUE))?.stamp)
        }

    @Test
    fun `a saved finder shows at once dated, then a failed read keeps it`() =
        runTest(main) {
            val stub = stub()
            val cache = MemoryCache()
            open(viewModel(stub, cache))
            stub.failure = IOException("no signal")
            val second = viewModel(stub, cache)
            open(second)
            assertTrue(loaded(second).stale)
            assertEquals("Last read Sat 12:00 pm", second.stampWords())
            assertEquals(
                best,
                loaded(second)
                    .model.rows
                    .first()
                    .key,
            )
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
    fun `every trade and their gain reorder the finder`() =
        runTest(main) {
            val vm = viewModel(stub())
            open(vm)
            vm.sortBy(TradeSort.Theirs)
            assertEquals(webBest("theirs"), loaded(vm).model.rows.map { it.key })
            vm.showEvery(true)
            assertTrue(loaded(vm).model.rows.size > 11)
            vm.showEvery(false)
            assertEquals(webBest("theirs"), loaded(vm).model.rows.map { it.key })
        }

    @Test
    fun `a trade opens into its players and the basis says their columns`() =
        runTest(main) {
            val vm = viewModel(stub())
            open(vm)
            assertEquals(TradesOpened.None, vm.ui.value.open)
            vm.toggle(best)
            assertEquals(setOf(best), vm.ui.value.opened)
            assertEquals(TradesOpened.Trade, vm.ui.value.open)
            vm.toggle(best)
            assertTrue(
                vm.ui.value.opened
                    .isEmpty(),
            )
        }

    @Test
    fun `the picker reads the trades holding a player and every trade again`() =
        runTest(main) {
            val stub = stub()
            val vm = viewModel(stub)
            open(vm)
            run(vm.pick(TradeFixtures.RODGERS, TradeFixtures.LEAGUE))
            val web = TradesParity.file.getValue("holding").jsonObject
            val keys = web.getValue("rows").jsonArray.map { it.jsonObject["key"].toString().trim('"') }
            assertEquals(keys, loaded(vm).model.rows.map { it.key })
            assertEquals("Aaron Rodgers", loaded(vm).model.picker.label)
            assertEquals(listOf(null, TradeFixtures.RODGERS), stub.reads)
            run(vm.pick(null, TradeFixtures.LEAGUE))
            assertEquals(9, loaded(vm).model.rows.size)
            assertEquals(2, stub.reads.size)
        }

    @Test
    fun `a player our board does not place is in no trade and is not read`() =
        runTest(main) {
            val stub = stub()
            val vm = viewModel(stub)
            open(vm)
            val unplaced =
                loaded(vm)
                    .model.picker.yours
                    .first { it.key.startsWith(TradeFinder.UNPLACED) }
            assertNull(vm.pick(unplaced.key, TradeFixtures.LEAGUE))
            val model = loaded(vm).model
            assertTrue(model.noneHolding)
            assertEquals("No trade we found includes ${unplaced.name}.", model.decision)
            assertEquals(listOf<String?>(null), stub.reads)
        }

    @Test
    fun `a holding read with no signal keeps the rows with the web's line`() =
        runTest(main) {
            val stub = stub()
            val vm = viewModel(stub)
            open(vm)
            stub.failure = IOException("no signal")
            run(vm.pick(TradeFixtures.RODGERS, TradeFixtures.LEAGUE))
            assertEquals(Words.InSeason.narrowingUnread, vm.ui.value.problem)
            assertFalse(vm.ui.value.narrowing)
            assertEquals("Last read Sat 12:00 pm", vm.stampWords())
        }

    @Test
    fun `build from this posts the trade and draws both lineups`() =
        runTest(main) {
            val stub = stub()
            val copies = mutableListOf<String>()
            val opened = mutableListOf<String>()
            val vm = viewModel(stub, copies = copies, opened = opened)
            open(vm)
            run(vm.buildFrom(best, TradeFixtures.LEAGUE))
            assertEquals(listOf(TradeCheckInput(8, listOf("96"), listOf("7526", "8116"))), stub.checked)
            val builder = requireNotNull(vm.ui.value.builder)
            // The best trade moves Waddle, whose Thursday game is final: no change this week (heldCheck).
            assertEquals(Words.Box.none, builder.bug.yours.figures.projBefore)
            assertEquals("7.3", builder.bug.yours.figures.seasonAfter)
            assertEquals("Max_Jensen10", builder.bug.theirs.name)
            assertEquals("5-1, 2nd of 12", builder.yours.aside)
            assertEquals(
                TradesParity.file
                    .getValue("builder")
                    .jsonObject["sentence"]
                    .toString()
                    .trim('"'),
                builder.sentence,
            )
            assertEquals(TradesOpened.Builder, vm.ui.value.open)
            vm.pressBuilder()
            assertEquals(
                TradesParity.file
                    .getValue("copied")
                    .jsonObject["done"]
                    .toString()
                    .trim('"'),
                vm.ui.value.builderCopied
                    ?.words,
            )
            assertTrue(copies.single().startsWith("Trade with Max_Jensen10: Aaron Rodgers (QB PIT) for "))
            assertEquals(listOf(TradeFixtures.trades().hostTradesUrl), opened)
        }

    @Test
    fun `build a trade asks for both sides, then checks as picks land`() =
        runTest(main) {
            val stub = stub()
            val vm = viewModel(stub)
            open(vm)
            vm.buildNew()
            val opening = requireNotNull(vm.ui.value.builder)
            assertEquals(Words.Builder.pickBoth, opening.sentence)
            assertTrue(opening.quiet)
            assertEquals(Words.Box.none, opening.bug.yours.figures.projBefore)
            assertFalse(opening.verbEnabled)
            run(vm.chooseTeam(8, TradeFixtures.LEAGUE))
            run(vm.tap(PickSide.Give, "96", TradeFixtures.LEAGUE))
            assertEquals(
                Words.Builder.pickTheirs,
                vm.ui.value.builder
                    ?.sentence,
            )
            assertTrue(stub.checked.isEmpty())
            run(vm.tap(PickSide.Get, "12481", TradeFixtures.LEAGUE))
            assertEquals(listOf(TradeCheckInput(8, listOf("96"), listOf("12481"))), stub.checked)
            assertEquals(
                true,
                vm.ui.value.builder
                    ?.verbEnabled,
            )
            run(vm.tap(PickSide.Get, "12481", TradeFixtures.LEAGUE))
            assertEquals(
                Words.Builder.pickTheirs,
                vm.ui.value.builder
                    ?.sentence,
            )
            vm.closeBuilder()
            assertNull(vm.ui.value.builder)
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
            run(vm.buildFrom(best, TradeFixtures.LEAGUE))
            assertEquals(
                Words.InSeason.narrowingUnread,
                vm.ui.value.builder
                    ?.sentence,
            )
            assertFalse(loaded(vm).stale)
        }

    @Test
    fun `a check with no signal keeps the finder with its stamp and asks again on the next pick`() =
        runTest(main) {
            val stub = stub()
            stub.checkFailure = IOException("no signal")
            val vm = viewModel(stub)
            open(vm)
            run(vm.buildFrom(best, TradeFixtures.LEAGUE))
            assertEquals(
                Words.InSeason.narrowingUnread,
                vm.ui.value.builder
                    ?.sentence,
            )
            assertTrue(loaded(vm).stale)
            assertEquals(
                best,
                loaded(vm)
                    .model.rows
                    .first()
                    .key,
            )
            stub.checkFailure = null
            run(vm.tap(PickSide.Get, "8116", TradeFixtures.LEAGUE))
            run(vm.tap(PickSide.Get, "8116", TradeFixtures.LEAGUE))
            assertEquals(
                true,
                vm.ui.value.builder
                    ?.verbEnabled,
            )
        }

    @Test
    fun `a check the API refuses says the API's sentence and leaves the finder fresh`() =
        runTest(main) {
            val stub = stub()
            stub.checkFailure = ApiFailure(422, "invalid", "Josh Allen is not on your roster.")
            val vm = viewModel(stub)
            open(vm)
            run(vm.buildFrom(best, TradeFixtures.LEAGUE))
            assertEquals(
                "Josh Allen is not on your roster.",
                vm.ui.value.builder
                    ?.sentence,
            )
            assertFalse(loaded(vm).stale)
            assertNull(vm.stampWords())
        }

    @Test
    fun `the verb copies the web's share text, says where to propose it and opens the page`() =
        runTest(main) {
            val copies = mutableListOf<String>()
            val opened = mutableListOf<String>()
            val vm = viewModel(stub(), copies = copies, opened = opened)
            open(vm)
            vm.press(best)
            val web =
                TradesParity.file
                    .getValue("clocks")
                    .jsonObject
                    .getValue(TradeFixtures.WEEK)
                    .jsonObject
                    .getValue("finder")
                    .jsonObject
                    .getValue("best")
                    .jsonObject
                    .getValue("mine")
                    .jsonArray
                    .first()
                    .jsonObject
            assertEquals(listOf(web["offer"].toString().trim('"')), copies)
            assertEquals(
                "Copied. Propose it on FFPC's trade page.",
                vm.ui.value.copied[best]
                    ?.words,
            )
            assertEquals(listOf(TradeFixtures.trades().hostTradesUrl), opened)
        }

    @Test
    fun `a copy that did not take says so`() =
        runTest(main) {
            val vm = viewModel(stub(), copyTakes = false)
            open(vm)
            vm.press(best)
            assertEquals(
                TradesParity.file
                    .getValue("copied")
                    .jsonObject["failed"]
                    .toString()
                    .trim('"'),
                vm.ui.value.copied[best]
                    ?.words,
            )
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
    fun `an opened trade's rows open the player sheet by their ids`() {
        val ids = TradesParity.model(TradeFixtures.WEEK).sheetPlayers.map { it.id }
        assertTrue("96" in ids)
        assertTrue("7526" in ids)
        // A player the site has no page for (no slug) opens no sheet, as the web's row draws no link.
        assertFalse("8116" in ids)
    }

    @Test
    fun `on Sunday afternoon the trade's moving players in play draw no week`() {
        val line = TradesParity.model(TradeFixtures.SUNDAY).row(best)
        assertNull(requireNotNull(line).opened.week)
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
        val model = TradesModel(advice, null, null, LeagueHost.ffpc, "", false, TradeSort.Mine, saturday, Fixtures.zone)
        assertTrue(model.basis(TradesOpened.None).contains("Week 6 projections expected Thursday."))
        assertFalse(model.basis(TradesOpened.None).contains("published projection"))
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

/** The fixture's trades, the trades holding Aaron Rodgers and the check, counted; or failing as told. */
internal class TradesStub(
    private val advice: TradeAdvice,
    private val holding: TradeAdvice,
    private val check: TradeCheck?,
) : TradeReads {
    var failure: Exception? = null
    var checkFailure: Exception? = null
    val reads = mutableListOf<String?>()
    val checked = mutableListOf<TradeCheckInput>()

    override suspend fun trades(
        leagueId: String,
        player: String?,
    ): String {
        reads += player
        failure?.let { throw it }
        return envelopeOf(if (player == null) advice else holding)
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
