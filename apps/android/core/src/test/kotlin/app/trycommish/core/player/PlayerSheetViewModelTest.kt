package app.trycommish.core.player

import app.trycommish.api.Unauthorized
import app.trycommish.api.models.BoardFormat
import app.trycommish.api.models.LeagueHost
import app.trycommish.api.models.LeaguePhase
import app.trycommish.api.models.ScoringPreset
import app.trycommish.core.AppWords
import app.trycommish.core.Cache
import app.trycommish.core.FixedClock
import app.trycommish.core.MemoryCache
import app.trycommish.core.SessionEnd
import app.trycommish.core.board.RunFixture
import app.trycommish.core.board.StubRunReads
import app.trycommish.core.shell.FollowedLeague
import app.trycommish.core.shell.PlayerSheetHost
import app.trycommish.core.shell.SheetOffer
import app.trycommish.core.shell.SheetPlayer
import app.trycommish.core.shell.SheetVerb
import app.trycommish.core.shell.unreadBasis
import app.trycommish.core.start.GameRead
import app.trycommish.design.Words
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertInstanceOf
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertSame
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.time.Instant

/** The fixture league as the shell holds it. */
internal val fixtureLeague =
    FollowedLeague(
        id = WeekFixture.LEAGUE,
        name = "Sunday Standard",
        host = LeagueHost.espn,
        scoring = ScoringPreset.ppr,
        format = BoardFormat.ppr,
        phase = LeaguePhase.in_season,
        draftAt = null,
        waiversOpen = true,
    )

/** A sheet player as a lineup row draws him: his platform id, his board id, his page's slug. */
internal fun sheetPlayer(
    board: String,
    slug: String,
    name: String = "Rome Odunze",
    host: String = "host-$board",
): SheetPlayer = SheetPlayer(host, slug, name, "WR", "25", "CHI", null, boardId = board)

/**
 * The player sheet's view model, held as the iOS one is: his card from the run and his week in the league,
 * each run file naming its kept ETag so a second open costs 304s, the saved reads standing offline with
 * their stamp, the shelf's words with nothing saved, a slug the index lacks keeping his week's card by the
 * row's board id, a refused token signing out, and Review Focus 3: the sheet keeps its player and its one
 * view model across a parent refresh, his week read once.
 */
class PlayerSheetViewModelTest {
    private val odunze = sheetPlayer("4431299", "rome-odunze")

    private class Ends : SessionEnd {
        var count = 0

        override fun signedOut() {
            count++
        }
    }

    private class Reads(
        val run: StubRunReads = StubRunReads(RunFixture.StandIn),
        val pages: StubPages = StubPages(RunFixture.StandIn),
        val weeks: StubWeeks = StubWeeks(),
        val cache: Cache = MemoryCache(),
        val ends: Ends = Ends(),
        at: Instant = WeekFixture.week,
    ) {
        val graph = playerGraph(run, pages, weeks, cache, FixedClock(at), ends)
    }

    private fun slugOf(id: String): String = RunFixture.StandIn.page(id).slug

    @Test
    fun `his card is read from the run and his week in the league`() =
        runTest {
            val reads = Reads()
            val vm = PlayerSheetViewModel(odunze.copy(slug = slugOf("4431299")), reads.graph, fixtureLeague)
            vm.load()
            val loaded = assertInstanceOf(SheetState.Loaded::class.java, vm.state.value)
            assertEquals(listOf("league:4431299"), reads.weeks.reads)
            assertEquals(6, loaded.card.tiles.size)
            assertNotNull(loaded.card.read)
            assertNull(loaded.freshness.saved)
            assertNull(vm.stampWords())
        }

    @Test
    fun `a second open names the kept ETags and costs 304s`() =
        runTest {
            val reads = Reads()
            val player = odunze.copy(slug = slugOf("4431299"))
            PlayerSheetViewModel(player, reads.graph, fixtureLeague).load()
            reads.pages.sent.clear()
            reads.run.answered.clear()
            PlayerSheetViewModel(player, reads.graph, fixtureLeague).load()
            assertTrue(reads.run.answered.isNotEmpty())
            assertTrue(reads.run.answered.all { it == NOT_MODIFIED }, "${reads.run.answered}")
            assertTrue(reads.pages.sent.all { it.second != null }, "${reads.pages.sent}")
        }

    @Test
    fun `offline the saved reads stand with their stamp`() =
        runTest {
            val cache = MemoryCache()
            val player = odunze.copy(slug = slugOf("4431299"))
            PlayerSheetViewModel(player, Reads(cache = cache).graph, fixtureLeague).load()
            val offline =
                Reads(
                    run = StubRunReads(RunFixture.StandIn, offline = true),
                    pages = StubPages(RunFixture.StandIn, offline = true),
                    weeks = StubWeeks(offline = true),
                    cache = cache,
                    at = WeekFixture.week.plusSeconds(HOUR),
                )
            val vm = PlayerSheetViewModel(player, offline.graph, fixtureLeague)
            vm.load()
            val loaded = assertInstanceOf(SheetState.Loaded::class.java, vm.state.value)
            assertEquals(SavedReason.Offline, loaded.freshness.saved)
            assertEquals(WeekFixture.week, loaded.freshness.stamp)
            assertEquals("${AppWords.lastRead} Sat 12:00 pm", vm.stampWords())
        }

    @Test
    fun `with nothing saved and no answer the shelf says his week could not be read`() =
        runTest {
            val reads =
                Reads(
                    StubRunReads(RunFixture.StandIn, offline = true),
                    StubPages(RunFixture.StandIn, offline = true),
                    StubWeeks(offline = true),
                )
            val vm = PlayerSheetViewModel(odunze, reads.graph, fixtureLeague)
            vm.load()
            assertEquals(SheetState.Failed(unreadBasis(failed = true, weekTile = Words.Card.proj)), vm.state.value)
        }

    @Test
    fun `a slug the index does not name keeps his week's card by the row's board id`() =
        runTest {
            val reads = Reads()
            val vm = PlayerSheetViewModel(odunze.copy(slug = "not-on-the-run"), reads.graph, fixtureLeague)
            vm.load()
            val loaded = assertInstanceOf(SheetState.Loaded::class.java, vm.state.value)
            assertEquals(listOf("league:4431299"), reads.weeks.reads)
            assertNull(loaded.card.read, "his page cannot be found, so no read")
        }

    @Test
    fun `the league's week failing reads his public week`() =
        runTest {
            val reads = Reads(weeks = StubWeeks(leagueFails = true))
            val vm = PlayerSheetViewModel(odunze.copy(slug = slugOf("4431299")), reads.graph, fixtureLeague)
            vm.load()
            assertInstanceOf(SheetState.Loaded::class.java, vm.state.value)
            assertEquals(listOf("league:4431299", "public:4431299"), reads.weeks.reads)
        }

    @Test
    fun `a refused token signs out`() =
        runTest {
            val ends = Ends()
            val weeks =
                object : PlayerWeekReads {
                    override suspend fun leagueWeek(
                        league: String,
                        player: String,
                    ): String = throw Unauthorized()

                    override suspend fun publicWeek(player: String): String = throw Unauthorized()
                }
            val graph =
                PlayerReadsGraph(
                    StubRunReads(RunFixture.StandIn),
                    StubPages(RunFixture.StandIn),
                    weeks,
                    MemoryCache(),
                    FixedClock(WeekFixture.week),
                    WeekFixture.zone,
                    ends,
                )
            val vm = PlayerSheetViewModel(odunze, graph, fixtureLeague)
            vm.load()
            assertEquals(SheetState.Failed(AppWords.signedOut), vm.state.value)
            assertEquals(1, ends.count)
        }

    @Test
    fun `the sheet keeps its player and its one view model across a parent refresh`() =
        runTest {
            val reads = Reads()
            var made = 0
            val sheets =
                PlayerSheets { player ->
                    made++
                    PlayerSheetViewModel(player, reads.graph, fixtureLeague)
                }
            val host = PlayerSheetHost()
            val first = odunze.copy(slug = slugOf("4431299"))
            val other = sheetPlayer("3139477", slugOf("3139477"), "Patrick Mahomes")
            host.open(first)
            val vm = sheets.of(requireNotNull(host.shown.value))
            vm.load()
            // The list under the sheet reads again: a new order, his fresh facts.
            host.parentRefreshed(listOf(other, first.copy(rank = "24")))
            val shown = requireNotNull(host.shown.value)
            assertEquals(first.id, shown.id)
            assertEquals("24", shown.rank)
            assertSame(vm, sheets.of(shown))
            assertEquals(1, made, "one view model")
            assertEquals(listOf("league:4431299"), reads.weeks.reads, "one week read")
            // Another player's sheet makes his own.
            host.open(other)
            val next = sheets.of(requireNotNull(host.shown.value))
            assertEquals(other.id, next.player.id)
            assertEquals(2, made)
        }

    @Test
    fun `the screen's verb is pinned and gives way to his game on a lineup screen`() {
        val lineup = SheetOffer(Words.Shelf.backToLineup, "WR, Odunze in, Moore out", lineup = true) {}
        val waivers = SheetOffer("Claim on ESPN", "Odunze for Moore, +2.1 a game", lineup = false) {}
        assertNull(SheetVerb.of(null, GameRead.Upcoming))
        assertEquals(SheetVerb.Act(lineup.label, lineup.line), SheetVerb.of(lineup, null))
        assertEquals(SheetVerb.Act(lineup.label, lineup.line), SheetVerb.of(lineup, GameRead.Upcoming))
        assertEquals(SheetVerb.Held(Words.Card.kickedOff), SheetVerb.of(lineup, GameRead.KickedOff))
        assertEquals(SheetVerb.Held(Words.Card.gameFinal), SheetVerb.of(lineup, GameRead.Final))
        assertEquals(SheetVerb.Act(waivers.label, waivers.line), SheetVerb.of(waivers, GameRead.KickedOff))
        val host = PlayerSheetHost()
        host.open(odunze, lineup)
        assertSame(lineup, host.offer)
        host.close()
        assertNull(host.offer)
    }

    private companion object {
        const val NOT_MODIFIED = 304
        const val HOUR = 3600L
    }
}
