package app.trycommish.storeshots

import androidx.compose.runtime.Composable
import app.trycommish.api.models.BoardFormat
import app.trycommish.api.models.HostMoveInput
import app.trycommish.api.models.HostMovePlan
import app.trycommish.api.models.HostMoveResult
import app.trycommish.api.models.LeagueHost
import app.trycommish.api.models.LeaguePhase
import app.trycommish.api.models.LineupAdvice
import app.trycommish.api.models.LineupSlot
import app.trycommish.api.models.ScoringPreset
import app.trycommish.api.models.TradeCheck
import app.trycommish.api.models.TradeCheckInput
import app.trycommish.api.models.WaiverAdvice
import app.trycommish.core.FixedClock
import app.trycommish.core.MemoryCache
import app.trycommish.core.SessionEnd
import app.trycommish.core.board.BoardModel
import app.trycommish.core.board.BoardState
import app.trycommish.core.board.RunFixture
import app.trycommish.core.board.StubRunReads
import app.trycommish.core.leaguehome.Fixtures
import app.trycommish.core.matchup.MatchupFixtures
import app.trycommish.core.matchup.MatchupState
import app.trycommish.core.matchup.matchupModel
import app.trycommish.core.matchup.matchupStamp
import app.trycommish.core.mock.MockFixtures
import app.trycommish.core.mock.MockRoomViewModel
import app.trycommish.core.mock.StubMock
import app.trycommish.core.phoneBar
import app.trycommish.core.player.PlayerPageViewModel
import app.trycommish.core.player.StubPages
import app.trycommish.core.player.StubWeeks
import app.trycommish.core.player.WeekFixture
import app.trycommish.core.player.playerGraph
import app.trycommish.core.rankings.RankingsViewModel
import app.trycommish.core.rankings.StubRankings
import app.trycommish.core.shell.FollowedLeague
import app.trycommish.core.shell.leagueSwitch
import app.trycommish.core.start.StartFixtures
import app.trycommish.core.start.StartState
import app.trycommish.core.start.StartUi
import app.trycommish.core.start.startModel
import app.trycommish.core.start.startPin
import app.trycommish.core.start.startStamp
import app.trycommish.core.trades.TradeFixtures
import app.trycommish.core.trades.TradeMe
import app.trycommish.core.trades.TradeReads
import app.trycommish.core.trades.TradesViewModel
import app.trycommish.core.waivers.WaiverFixtures
import app.trycommish.core.waivers.WaiverNav
import app.trycommish.core.waivers.WaiverPosition
import app.trycommish.core.waivers.WaiverReads
import app.trycommish.core.waivers.WaiverViewModel
import app.trycommish.core.waivers.envelopeOf
import app.trycommish.feature.board.BoardActions
import app.trycommish.feature.board.BoardScreen
import app.trycommish.feature.matchup.MatchupActions
import app.trycommish.feature.matchup.MatchupScreen
import app.trycommish.feature.mock.MockRoomExits
import app.trycommish.feature.mock.MockRoomView
import app.trycommish.feature.player.PlayerPageView
import app.trycommish.feature.rankings.RankingsActions
import app.trycommish.feature.rankings.RankingsHead
import app.trycommish.feature.rankings.RankingsScreen
import app.trycommish.feature.start.StartActions
import app.trycommish.feature.start.StartScreen
import app.trycommish.feature.trades.TradeActions
import app.trycommish.feature.trades.TradesScreen
import app.trycommish.feature.waivers.WaiverActions
import app.trycommish.feature.waivers.WaiverScreen
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.TestCoroutineScheduler
import java.io.IOException
import app.trycommish.core.trades.envelopeOf as tradesEnvelope

/**
 * The eight phone screenshots, in the listing's order (docs/store/2026-10-26-play-listing.md §1.2): each
 * caption, the file it is written to, and whether the app draws its bars around the screen (the mock
 * room is full screen over the shell). The in-season tabs light their own tab; the rankings, the board
 * and the player page are pages pushed over the bar, so none is lit.
 */
enum class StoreShot(
    val file: String,
    val caption: String,
    val tab: String?,
    val chrome: Boolean = true,
) {
    Lineup("phone-1-lineup", "The lineup to start, every week", "start"),
    Waivers("phone-2-waivers", "Your best add on waivers", "waivers"),
    Trades("phone-3-trades", "Trades that help both teams", "trades"),
    Matchup("phone-4-matchup", "Your game, kept up to date", "matchup"),
    Rankings("phone-5-rankings", "Our rest-of-season order", null),
    Board("phone-6-board", "The board in every format", null),
    MockRoom("phone-7-mock-room", "Our call at every pick", null, chrome = false),
    Player("phone-8-player-page", "Every number with its basis", null),
}

/** The fixture league's name in the store shots: a made-up name, never the recorded league's own. */
const val STORE_LEAGUE = "Sunday Standard"

/** The member's team in the store shots, as the trade finder names it. */
private val ME = TradeMe("Fourth and Long", "1-4, 11th of 12")

/** The fixture league as the shell holds it, on a platform that takes the app's moves. */
val storeLeague =
    FollowedLeague(
        Fixtures.LEAGUE_ID,
        STORE_LEAGUE,
        LeagueHost.espn,
        ScoringPreset.ppr,
        BoardFormat.ppr,
        LeaguePhase.in_season,
        null,
        true,
    )

/** The shell's bars for a shot, at the fixture's Saturday clock. */
fun chromeOf(shot: StoreShot): StoreChrome? {
    if (!shot.chrome) return null
    val face = leagueSwitch(listOf(storeLeague), storeLeague.id, StartFixtures.instant(StartFixtures.WEEK), Fixtures.zone).face
    return StoreChrome(face, phoneBar(storeLeague, null), shot.tab)
}

/** A shot's screen and what it draws from: the objects handed to it, whose strings the store check reads
 * for a platform's name (StoreStrings.kt, Lane 310). */
class StoreScreen(
    val drawn: List<Any?>,
    val draw: @Composable () -> Unit,
)

/** The shot's screen, its view model read through the fixtures on `scheduler` before anything is drawn. */
fun screenOf(
    shot: StoreShot,
    scheduler: TestCoroutineScheduler,
): StoreScreen =
    when (shot) {
        StoreShot.Lineup -> lineup()
        StoreShot.Waivers -> waivers(scheduler)
        StoreShot.Trades -> trades(scheduler)
        StoreShot.Matchup -> matchup()
        StoreShot.Rankings -> rankings(scheduler)
        StoreShot.Board -> board()
        StoreShot.MockRoom -> mockRoom(scheduler)
        StoreShot.Player -> player()
    }

/** Saturday noon, the lineup on a platform that takes it: the swaps and the one verb that sets them, the
 * platform the neutral one. */
private fun lineup(): StoreScreen {
    val now = StartFixtures.instant(StartFixtures.WEEK)
    val advice = everySlotFilled(StartFixtures.writes(StartFixtures.WEEK))
    val model = startModel(advice, storeLeague.host, now, Fixtures.zone, storeHost)
    val ui = StartUi(state = StartState.Loaded(model, now, stale = false))
    val stamp = startStamp(ui, Fixtures.zone)
    val pin = startPin(ui, storeHost.name, Fixtures.zone)
    return StoreScreen(listOf(ui, stamp, pin)) { StartScreen(ui, stamp, pin, refreshing = false, actions = StartActions()) }
}

/**
 * The first store shot shows the lineup working, not a hole (the coordinator's ruling, Lane 255): in the
 * fixture the set TE is on his bye and the bench TE is ruled out, so no one can fill the slot. Here the
 * bench TE is cleared to play and the advice starts him, the bye TE goes to the bench, as the API answers a
 * playable swap. The store run only; every other line is the fixture's own.
 */
internal fun everySlotFilled(advice: LineupAdvice): LineupAdvice {
    val empty = advice.slots.single { it.slot == LineupSlot.Slot.TE && it.noOneCanPlay }
    val ruledOut = advice.bench.single { it.player.position == "TE" && it.facts.designation != null }
    val playing = ruledOut.copy(facts = ruledOut.facts.copy(designation = null))
    return advice.copy(
        slots = advice.slots.map { if (it == empty) it.copy(ours = playing, changed = true, noOneCanPlay = false) else it },
        bench = advice.bench.map { if (it == ruledOut) empty.ours else it },
    )
}

/** Saturday noon, the wire before it clears: the best add first, the claim pinned. */
private fun waivers(scheduler: TestCoroutineScheduler): StoreScreen {
    val league = WaiverFixtures.PENDING
    val reads = FixtureWaivers(WaiverFixtures.waivers(league))
    val clock = FixedClock(StartFixtures.instant(WaiverFixtures.WEEK))
    val vm = WaiverViewModel(reads, MemoryCache(), clock, Fixtures.zone, storeLeague.host, { true }, {}, {}, storeHost)
    vm.load(league)
    scheduler.advanceUntilIdle()
    val ui = vm.ui.value
    val stamp = vm.stampWords(ui)
    val pin = vm.pin(ui)
    return StoreScreen(listOf(ui, stamp, pin)) {
        WaiverScreen(ui, stamp, pin, refreshing = false, actions = WaiverActions(), still = true)
    }
}

/** Saturday noon, the builder with our best idea loaded into its ticks. */
private fun trades(scheduler: TestCoroutineScheduler): StoreScreen {
    val clock = FixedClock(StartFixtures.instant(TradeFixtures.WEEK))
    val reads = FixtureTrades(tradesEnvelope(TradeFixtures.trades()), TradeFixtures.check(TradeFixtures.WEEK, 1))
    val vm = TradesViewModel(reads, MemoryCache(), clock, Fixtures.zone, storeLeague.host, ME, { true }, {}, {}, storeHost)
    vm.load(TradeFixtures.LEAGUE)
    scheduler.advanceUntilIdle()
    vm.loadIdea(TradeFixtures.BEST, TradeFixtures.LEAGUE)
    scheduler.advanceUntilIdle()
    val ui = vm.ui.value
    val stamp = vm.stampWords(ui)
    return StoreScreen(listOf(ui, stamp)) { TradesScreen(ui, stamp, refreshing = false, actions = TradeActions()) }
}

/** Sunday afternoon, the member's game with its points coming in. */
private fun matchup(): StoreScreen {
    val now = StartFixtures.instant(MatchupFixtures.SUNDAY)
    val sync = MatchupFixtures.sync(MatchupFixtures.SUNDAY)
    val model = matchupModel(sync, MatchupFixtures.box(MatchupFixtures.SUNDAY), now, Fixtures.zone, host = storeHost)
    val state = MatchupState.Loaded(model, now, stale = false)
    val stamp = matchupStamp(state, Fixtures.zone)
    return StoreScreen(listOf(state, stamp)) { MatchupScreen(state, stamp, refreshing = false, actions = MatchupActions()) }
}

/** Saturday noon, our rest-of-season order with no league, every position. */
private fun rankings(scheduler: TestCoroutineScheduler): StoreScreen {
    val clock = FixedClock(StartFixtures.instant(StartFixtures.WEEK))
    val vm = RankingsViewModel(StubRankings(), MemoryCache(), clock, Fixtures.zone, inSeason = true, query = "", sessionEnd = {})
    vm.load()
    scheduler.advanceUntilIdle()
    val ui = vm.ui.value
    val head = RankingsHead(vm.name, vm.lead(ui), vm.stampWords(ui))
    return StoreScreen(listOf(ui, head)) { RankingsScreen(ui, head, refreshing = false, actions = RankingsActions()) }
}

/** Before the draft, the PPR board from its top: the tiers and the drop to the next one. */
private fun board(): StoreScreen {
    val model =
        BoardModel.of(
            RunFixture.StandIn.read(),
            null,
            inSeason = false,
            following = false,
            now = RunFixture.preDraft,
            zone = RunFixture.zone,
        )
    val state = BoardState.Loaded(model, RunFixture.preDraft, stale = null)
    return StoreScreen(
        listOf(state, model.formats),
    ) { BoardScreen(state, null, model.formats, refreshing = false, actions = BoardActions()) }
}

/** A mock draft against bots at round 5, the member on the clock: our call above the pool. */
private fun mockRoom(scheduler: TestCoroutineScheduler): StoreScreen {
    val stub = StubMock(MockFixtures.Answer.Round5)
    val vm = MockRoomViewModel(MockFixtures.ID, stub, MemoryCache(), FixedClock(MockFixtures.readAt), MockFixtures.zone, SessionEnd {})
    vm.load()
    scheduler.advanceUntilIdle()
    return StoreScreen(listOf(vm.state.value)) { MockRoomView(vm, MockRoomExits({}, {}, {})) }
}

/** A player's page from its top in the fixture league at Saturday noon: his week's game and figures,
 * the board's projection and where drafters take him. */
private fun player(): StoreScreen {
    val graph =
        playerGraph(
            StubRunReads(RunFixture.StandIn),
            StubPages(RunFixture.StandIn),
            StubWeeks(WeekFixture.week),
            MemoryCache(),
            FixedClock(WeekFixture.week),
        )
    val vm = PlayerPageViewModel(PLAYER, graph, storeLeague)
    runBlocking { vm.read() }
    val state = vm.state.value
    val stamp = vm.stampWords(state)
    return StoreScreen(listOf(state, stamp)) { PlayerPageView(state, stamp, refreshing = false, refresh = {}) { _, _ -> {} } }
}

/** The stand-in run's player with a week read in the fixture league (the player tests' page hero). */
private const val PLAYER = "rome-odunze"

/** The waiver read as the fixture answers it; no claim is made in a store shot. */
private class FixtureWaivers(
    private val advice: WaiverAdvice,
) : WaiverReads {
    /** The page, or a position's own read as the API answers it: that position's rows (the screen opens on
     * the weakest Need and reads it). */
    override suspend fun waivers(
        leagueId: String,
        position: WaiverPosition?,
    ): String = envelopeOf(position?.let { WaiverNav.atPosition(advice, it.query) } ?: advice)

    override suspend fun planMove(
        leagueId: String,
        move: HostMoveInput,
    ): HostMovePlan = throw IOException("a store shot plans no claim")

    override suspend fun makeMove(
        leagueId: String,
        move: HostMoveInput,
        confirm: String,
    ): HostMoveResult = throw IOException("a store shot makes no claim")
}

/** The trades and their check as the fixture answers them. */
private class FixtureTrades(
    private val body: String,
    private val check: TradeCheck,
) : TradeReads {
    override suspend fun trades(
        leagueId: String,
        player: String?,
    ): String = body

    override suspend fun checkTrade(
        leagueId: String,
        trade: TradeCheckInput,
    ): TradeCheck = check
}
